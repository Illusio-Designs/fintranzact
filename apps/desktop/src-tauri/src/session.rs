//! Desktop session-token and trusted-device-token storage backed by the OS credential manager.
//!
//! The desktop app uses Bearer-token auth (not HttpOnly cookies) so that
//! the Tauri webview at `tauri.localhost` can talk to `${import.meta.env.API_URL}`
//! cross-origin without relaxing `SameSite=Lax` on web. Tokens are stored
//! in the OS-native credential store — Keychain on macOS, Credential Manager
//! on Windows, libsecret on Linux — matching the mobile app's
//! `expo-secure-store` posture.
//!
//! Design notes:
//! - Service name is the bundle identifier `in.fintranzact.app` so OS-level
//!   ACLs isolate this token from other apps running as the same user.
//! - Account name `session_token` is a stable label; we don't version it.
//! - On Linux, if libsecret / gnome-keyring isn't available (headless or
//!   minimal distro), operations will fail. We intentionally do NOT fall
//!   back to plaintext storage — the user re-logs in each launch instead.
//!   This matches the "never silently downgrade" guidance from the P0
//!   security review.
//! - Errors are returned as `String` so the TypeScript side can surface
//!   them verbatim. The JS side treats any failure as "no token available"
//!   and prompts re-login.

use keyring::Entry;

const SERVICE: &str = "in.fintranzact.app";
const ACCOUNT: &str = "session_token";
// Two-factor "trusted device" token. Same service, separate account, so
// signing out (which clears the session token) keeps the device trusted.
const TRUSTED_DEVICE_ACCOUNT: &str = "trusted_device_token";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("keyring init failed: {e}"))
}

fn save(account: &str, token: String) -> Result<(), String> {
    if token.is_empty() {
        return Err("empty token".into());
    }
    entry_for(account)?
        .set_password(&token)
        .map_err(|e| format!("keyring write failed: {e}"))
}

fn get(account: &str) -> Result<Option<String>, String> {
    match entry_for(account)?.get_password() {
        Ok(token) => Ok(Some(token)),
        // NoEntry means "nothing stored yet" — not an error condition.
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring read failed: {e}")),
    }
}

fn clear(account: &str) -> Result<(), String> {
    match entry_for(account)?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting a non-existent entry is not an error from the caller's
        // perspective — the end state is what was requested.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete failed: {e}")),
    }
}

#[tauri::command]
pub fn save_session_token(token: String) -> Result<(), String> {
    save(ACCOUNT, token)
}

#[tauri::command]
pub fn get_session_token() -> Result<Option<String>, String> {
    get(ACCOUNT)
}

#[tauri::command]
pub fn clear_session_token() -> Result<(), String> {
    clear(ACCOUNT)
}

#[tauri::command]
pub fn save_trusted_device_token(token: String) -> Result<(), String> {
    save(TRUSTED_DEVICE_ACCOUNT, token)
}

#[tauri::command]
pub fn get_trusted_device_token() -> Result<Option<String>, String> {
    get(TRUSTED_DEVICE_ACCOUNT)
}

#[tauri::command]
pub fn clear_trusted_device_token() -> Result<(), String> {
    clear(TRUSTED_DEVICE_ACCOUNT)
}
