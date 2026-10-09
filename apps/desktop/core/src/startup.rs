//! Keep the UI responsive while the OS asks permission to restore a saved credential.
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex, MutexGuard};

pub struct DeferredCredentials<T> {
    value: Mutex<Option<T>>,
    restoring: AtomicBool,
}
impl<T> Default for DeferredCredentials<T> {
    fn default() -> Self { Self { value: Mutex::new(None), restoring: AtomicBool::new(true) } }
}
impl<T> DeferredCredentials<T> {
    pub fn lock(&self) -> std::sync::LockResult<MutexGuard<'_, Option<T>>> { self.value.lock() }
    pub fn is_restoring(&self) -> bool { self.restoring.load(Ordering::SeqCst) }
    /// Call while holding the value lock when signing in, switching accounts, or signing out.
    pub fn invalidate_restore(&self) { self.restoring.store(false, Ordering::SeqCst); }
    pub fn finish_restore(&self, value: Option<T>) {
        let mut current = self.value.lock().unwrap();
        if self.restoring.swap(false, Ordering::SeqCst) { *current = value; }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn waiting_for_os_permission_does_not_lock_the_loading_status() {
        let state = DeferredCredentials::<String>::default();
        let _locked = state.lock().unwrap();
        assert!(state.is_restoring());
    }
    #[test] fn old_restore_cannot_replace_a_new_sign_in() {
        let state = DeferredCredentials::default();
        { let mut live = state.lock().unwrap(); state.invalidate_restore(); *live = Some("new-account"); }
        state.finish_restore(Some("old-account"));
        assert_eq!(*state.lock().unwrap(), Some("new-account"));
        assert!(!state.is_restoring());
    }
    #[test] fn sign_out_cannot_be_undone_by_a_late_restore() {
        let state = DeferredCredentials::default();
        { let mut live = state.lock().unwrap(); state.invalidate_restore(); *live = None; }
        state.finish_restore(Some("signed-out-account"));
        assert_eq!(*state.lock().unwrap(), None);
        assert!(!state.is_restoring());
    }
    #[test] fn completed_restore_exposes_the_original_saved_account() {
        let state = DeferredCredentials::default();
        state.finish_restore(Some("saved-account"));
        assert_eq!(*state.lock().unwrap(), Some("saved-account"));
        assert!(!state.is_restoring());
    }
}
