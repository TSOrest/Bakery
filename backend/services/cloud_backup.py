"""Хмарні провайдери для резервного копіювання.

Усі три провайдери реалізовані через прямі HTTP-запити (requests),
без зовнішніх SDK — щоб мінімізувати залежності.

Необхідна одноразова реєстрація OAuth-застосунку у кожного провайдера:
  Google Drive:  https://console.cloud.google.com/ → OAuth 2.0 Client ID (тип: Web)
  OneDrive:      https://portal.azure.com/ → App registrations (Public client)
  Dropbox:       https://www.dropbox.com/developers/apps → App Console

Redirect URI для всіх:  http://localhost:8000/api/v1/backup/cloud/callback/<provider>
"""

import json
import time
import urllib.parse
from pathlib import Path
from typing import Optional

import requests as rq

REDIRECT_BASE = "http://localhost:8000/api/v1/backup/cloud/callback"

# ─── Google Drive ─────────────────────────────────────────────────────────────

_G_AUTH   = "https://accounts.google.com/o/oauth2/v2/auth"
_G_TOKEN  = "https://oauth2.googleapis.com/token"
_G_API    = "https://www.googleapis.com/drive/v3"
_G_UP     = "https://www.googleapis.com/upload/drive/v3"
_G_SCOPE  = "https://www.googleapis.com/auth/drive.file"


def gdrive_auth_url(client_id: str) -> str:
    p = {
        "client_id": client_id,
        "redirect_uri": f"{REDIRECT_BASE}/google",
        "response_type": "code",
        "scope": _G_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{_G_AUTH}?{urllib.parse.urlencode(p)}"


def gdrive_exchange(client_id: str, client_secret: str, code: str) -> dict:
    r = rq.post(_G_TOKEN, data={
        "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": f"{REDIRECT_BASE}/google",
        "grant_type": "authorization_code", "code": code,
    }, timeout=15)
    r.raise_for_status()
    t = r.json()
    t["expires_at"] = time.time() + t.get("expires_in", 3600)
    return t


def _gdrive_refresh(client_id: str, client_secret: str, token: dict) -> dict:
    r = rq.post(_G_TOKEN, data={
        "client_id": client_id, "client_secret": client_secret,
        "refresh_token": token["refresh_token"],
        "grant_type": "refresh_token",
    }, timeout=15)
    r.raise_for_status()
    new = r.json()
    new.setdefault("refresh_token", token["refresh_token"])
    new["expires_at"] = time.time() + new.get("expires_in", 3600)
    return new


def _gdrive_token(client_id: str, client_secret: str, token: dict) -> tuple[str, dict]:
    if token.get("expires_at", 0) < time.time() + 60:
        token = _gdrive_refresh(client_id, client_secret, token)
    return token["access_token"], token


def _gdrive_folder_id(at: str, folder_name: str) -> str:
    h = {"Authorization": f"Bearer {at}"}
    q = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    r = rq.get(f"{_G_API}/files", headers=h, params={"q": q, "fields": "files(id)"}, timeout=10)
    r.raise_for_status()
    hits = r.json().get("files", [])
    if hits:
        return hits[0]["id"]
    r = rq.post(f"{_G_API}/files", headers=h,
                json={"name": folder_name, "mimeType": "application/vnd.google-apps.folder"},
                timeout=10)
    r.raise_for_status()
    return r.json()["id"]


def gdrive_upload(client_id: str, client_secret: str, token: dict,
                  file_path: Path, folder_name: str) -> tuple[str, dict]:
    at, token = _gdrive_token(client_id, client_secret, token)
    fid = _gdrive_folder_id(at, folder_name)
    data = file_path.read_bytes()
    r = rq.post(
        f"{_G_UP}/files?uploadType=multipart",
        headers={"Authorization": f"Bearer {at}"},
        files={
            "metadata": (None, json.dumps({"name": file_path.name, "parents": [fid]}),
                         "application/json; charset=UTF-8"),
            "file": (file_path.name, data, "application/octet-stream"),
        }, timeout=120,
    )
    r.raise_for_status()
    return r.json()["id"], token


def gdrive_list(client_id: str, client_secret: str, token: dict,
                folder_name: str) -> tuple[list, dict]:
    at, token = _gdrive_token(client_id, client_secret, token)
    fid = _gdrive_folder_id(at, folder_name)
    r = rq.get(f"{_G_API}/files", headers={"Authorization": f"Bearer {at}"}, params={
        "q": f"'{fid}' in parents and trashed=false and name contains 'bakery_'",
        "fields": "files(id,name,size,modifiedTime)",
        "orderBy": "modifiedTime desc",
    }, timeout=15)
    r.raise_for_status()
    files = [
        {"id": f["id"], "name": f["name"],
         "size_kb": round(int(f.get("size", 0)) / 1024, 1),
         "modified": f.get("modifiedTime", "")[:16].replace("T", " ")}
        for f in r.json().get("files", [])
    ]
    return files, token


def gdrive_download(client_id: str, client_secret: str, token: dict,
                    file_id: str) -> tuple[bytes, str, dict]:
    at, token = _gdrive_token(client_id, client_secret, token)
    h = {"Authorization": f"Bearer {at}"}
    meta = rq.get(f"{_G_API}/files/{file_id}", headers=h, params={"fields": "name"}, timeout=10)
    meta.raise_for_status()
    name = meta.json().get("name", "backup.db")
    r = rq.get(f"{_G_API}/files/{file_id}", headers=h, params={"alt": "media"}, timeout=120)
    r.raise_for_status()
    return r.content, name, token


# ─── OneDrive (Microsoft Graph) ───────────────────────────────────────────────

_MS_AUTH  = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
_MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
_MS_GRAPH = "https://graph.microsoft.com/v1.0/me/drive"
_MS_SCOPE = "Files.ReadWrite offline_access"


def onedrive_auth_url(client_id: str) -> str:
    p = {
        "client_id": client_id,
        "redirect_uri": f"{REDIRECT_BASE}/onedrive",
        "response_type": "code",
        "scope": _MS_SCOPE,
    }
    return f"{_MS_AUTH}?{urllib.parse.urlencode(p)}"


def onedrive_exchange(client_id: str, code: str) -> dict:
    r = rq.post(_MS_TOKEN, data={
        "client_id": client_id,
        "redirect_uri": f"{REDIRECT_BASE}/onedrive",
        "grant_type": "authorization_code", "code": code,
        "scope": _MS_SCOPE,
    }, timeout=15)
    r.raise_for_status()
    t = r.json()
    t["expires_at"] = time.time() + t.get("expires_in", 3600)
    return t


def _onedrive_token(client_id: str, token: dict) -> tuple[str, dict]:
    if token.get("expires_at", 0) < time.time() + 60:
        r = rq.post(_MS_TOKEN, data={
            "client_id": client_id,
            "refresh_token": token["refresh_token"],
            "grant_type": "refresh_token", "scope": _MS_SCOPE,
        }, timeout=15)
        r.raise_for_status()
        new = r.json()
        new.setdefault("refresh_token", token.get("refresh_token"))
        new["expires_at"] = time.time() + new.get("expires_in", 3600)
        token = new
    return token["access_token"], token


def onedrive_upload(client_id: str, token: dict,
                    file_path: Path, folder_name: str) -> tuple[str, dict]:
    at, token = _onedrive_token(client_id, token)
    data = file_path.read_bytes()
    r = rq.put(
        f"{_MS_GRAPH}/root:/{folder_name}/{file_path.name}:/content",
        headers={"Authorization": f"Bearer {at}", "Content-Type": "application/octet-stream"},
        data=data, timeout=120,
    )
    r.raise_for_status()
    return r.json().get("id", file_path.name), token


def onedrive_list(client_id: str, token: dict,
                  folder_name: str) -> tuple[list, dict]:
    at, token = _onedrive_token(client_id, token)
    r = rq.get(
        f"{_MS_GRAPH}/root:/{folder_name}:/children",
        headers={"Authorization": f"Bearer {at}"},
        params={"$orderby": "lastModifiedDateTime desc",
                "$select": "id,name,size,lastModifiedDateTime"},
        timeout=15,
    )
    if r.status_code == 404:
        return [], token
    r.raise_for_status()
    files = [
        {"id": f["id"], "name": f["name"],
         "size_kb": round(f.get("size", 0) / 1024, 1),
         "modified": f.get("lastModifiedDateTime", "")[:16].replace("T", " ")}
        for f in r.json().get("value", [])
        if f["name"].startswith("bakery_")
    ]
    return files, token


def onedrive_download(client_id: str, token: dict,
                      file_id: str) -> tuple[bytes, str, dict]:
    at, token = _onedrive_token(client_id, token)
    h = {"Authorization": f"Bearer {at}"}
    meta = rq.get(f"{_MS_GRAPH}/items/{file_id}", headers=h,
                  params={"$select": "name,@microsoft.graph.downloadUrl"}, timeout=10)
    meta.raise_for_status()
    info = meta.json()
    name = info.get("name", "backup.db")
    dl_url = info.get("@microsoft.graph.downloadUrl", "")
    r = rq.get(dl_url, timeout=120)
    r.raise_for_status()
    return r.content, name, token


# ─── Dropbox ──────────────────────────────────────────────────────────────────

_DBX_AUTH  = "https://www.dropbox.com/oauth2/authorize"
_DBX_TOKEN = "https://api.dropboxapi.com/oauth2/token"
_DBX_API   = "https://api.dropboxapi.com/2"
_DBX_CONT  = "https://content.dropboxapi.com/2"


def dropbox_auth_url(app_key: str) -> str:
    p = {
        "client_id": app_key,
        "redirect_uri": f"{REDIRECT_BASE}/dropbox",
        "response_type": "code",
        "token_access_type": "offline",
    }
    return f"{_DBX_AUTH}?{urllib.parse.urlencode(p)}"


def dropbox_exchange(app_key: str, app_secret: str, code: str) -> dict:
    r = rq.post(_DBX_TOKEN, data={
        "client_id": app_key, "client_secret": app_secret,
        "redirect_uri": f"{REDIRECT_BASE}/dropbox",
        "grant_type": "authorization_code", "code": code,
    }, timeout=15)
    r.raise_for_status()
    t = r.json()
    t["expires_at"] = time.time() + t.get("expires_in", 14400)
    return t


def _dropbox_token(app_key: str, app_secret: str, token: dict) -> tuple[str, dict]:
    if token.get("expires_at", 0) < time.time() + 60:
        r = rq.post(_DBX_TOKEN, data={
            "client_id": app_key, "client_secret": app_secret,
            "refresh_token": token.get("refresh_token", ""),
            "grant_type": "refresh_token",
        }, timeout=15)
        r.raise_for_status()
        new = r.json()
        new.setdefault("refresh_token", token.get("refresh_token"))
        new["expires_at"] = time.time() + new.get("expires_in", 14400)
        token = new
    return token["access_token"], token


def dropbox_upload(app_key: str, app_secret: str, token: dict,
                   file_path: Path, folder_name: str) -> tuple[str, dict]:
    at, token = _dropbox_token(app_key, app_secret, token)
    data = file_path.read_bytes()
    path = f"/{folder_name}/{file_path.name}"
    r = rq.post(
        f"{_DBX_CONT}/files/upload",
        headers={
            "Authorization": f"Bearer {at}",
            "Dropbox-API-Arg": json.dumps({"path": path, "mode": "overwrite"}),
            "Content-Type": "application/octet-stream",
        },
        data=data, timeout=120,
    )
    r.raise_for_status()
    return path, token


def dropbox_list(app_key: str, app_secret: str, token: dict,
                 folder_name: str) -> tuple[list, dict]:
    at, token = _dropbox_token(app_key, app_secret, token)
    r = rq.post(
        f"{_DBX_API}/files/list_folder",
        headers={"Authorization": f"Bearer {at}", "Content-Type": "application/json"},
        json={"path": f"/{folder_name}", "recursive": False},
        timeout=15,
    )
    if r.status_code == 409:   # folder not found
        return [], token
    r.raise_for_status()
    files = sorted(
        [
            {"id": f["path_lower"], "name": f["name"],
             "size_kb": round(f.get("size", 0) / 1024, 1),
             "modified": f.get("server_modified", "")[:16].replace("T", " ")}
            for f in r.json().get("entries", [])
            if f[".tag"] == "file" and f["name"].startswith("bakery_")
        ],
        key=lambda x: x["modified"], reverse=True,
    )
    return files, token


def dropbox_download(app_key: str, app_secret: str, token: dict,
                     file_path: str) -> tuple[bytes, str, dict]:
    """file_path — шлях Dropbox, напр. '/bakery-backups/bakery_xxx.db'."""
    at, token = _dropbox_token(app_key, app_secret, token)
    r = rq.post(
        f"{_DBX_CONT}/files/download",
        headers={
            "Authorization": f"Bearer {at}",
            "Dropbox-API-Arg": json.dumps({"path": file_path}),
        },
        timeout=120,
    )
    r.raise_for_status()
    name = json.loads(r.headers.get("Dropbox-API-Result", "{}")).get("name", file_path.split("/")[-1])
    return r.content, name, token
