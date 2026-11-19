pub mod api;
mod frb_generated; /* AUTO INJECTED BY flutter_rust_bridge. This line may not be accurate, and you can change it according to your needs. */
mod secure_store;

#[cfg(any(target_os = "android", test))]
fn validate_android_context_initialized(initialized: bool) -> Result<(), String> {
    if initialized {
        Ok(())
    } else {
        Err("Android application context was not initialized".to_string())
    }
}

#[cfg(any(target_os = "android", test))]
fn ffi_panic_boundary(operation: impl FnOnce()) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation)).is_ok()
}

#[cfg(target_os = "android")]
mod android_context {
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    use jni::objects::{GlobalRef, JClass, JObject};
    use jni::JNIEnv;

    static APPLICATION_CONTEXT: OnceLock<GlobalRef> = OnceLock::new();
    static INITIALIZED: OnceLock<Mutex<bool>> = OnceLock::new();

    /// Called from MainActivity before Flutter starts. Retaining a global
    /// reference keeps the Android application context valid for Rust/JNI.
    /// Failed initialization is not cached, so a later call can retry.
    #[no_mangle]
    pub extern "system" fn Java_com_inone_inone_1mobile_MainActivity_init_1android(
        env: JNIEnv,
        _class: JClass,
        context: JObject,
    ) {
        // JNI is a foreign ABI boundary; never allow a Rust unwind to escape
        // into the Android runtime. The initialized flag remains false on panic,
        // so native secure storage continues to fail closed.
        let _ = super::ffi_panic_boundary(|| {
            let state = INITIALIZED.get_or_init(|| Mutex::new(false));
            let Ok(mut initialized) = state.lock() else {
                return;
            };
            if *initialized {
                return;
            }

            let Ok(vm) = env.get_java_vm() else {
                return;
            };
            if APPLICATION_CONTEXT.get().is_none() {
                let Ok(global) = env.new_global_ref(&context) else {
                    return;
                };
                let _ = APPLICATION_CONTEXT.set(global);
            }
            let Some(retained) = APPLICATION_CONTEXT.get() else {
                return;
            };

            unsafe {
                ndk_context::initialize_android_context(
                    vm.get_java_vm_pointer() as *mut c_void,
                    retained.as_obj().as_raw() as *mut c_void,
                );
            }
            *initialized = true;
        });
    }

    pub fn ensure_initialized() -> Result<(), String> {
        let state = INITIALIZED.get_or_init(|| Mutex::new(false));
        let initialized = state
            .lock()
            .map_err(|error| format!("Android context initialization lock: {error}"))?;
        super::validate_android_context_initialized(*initialized)
    }
}

#[cfg(target_os = "android")]
pub(crate) fn ensure_android_context_initialized() -> Result<(), String> {
    android_context::ensure_initialized()
}

#[cfg(not(target_os = "android"))]
pub(crate) fn ensure_android_context_initialized() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ffi_panic_boundary, validate_android_context_initialized};

    #[test]
    fn jni_ffi_boundary_contains_unwinding_panics() {
        assert!(!ffi_panic_boundary(|| panic!(
            "simulated JNI callback panic"
        )));
        assert!(ffi_panic_boundary(|| {}));
    }

    #[test]
    fn native_key_store_context_gate_fails_closed_before_initialization() {
        let error = validate_android_context_initialized(false)
            .expect_err("an uninitialized Android context must never open the native key store");
        assert_eq!(error, "Android application context was not initialized");
        assert!(validate_android_context_initialized(true).is_ok());
    }
}
