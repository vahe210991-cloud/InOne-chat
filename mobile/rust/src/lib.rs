pub mod api;
mod secure_store;

#[cfg(any(target_os = "android", test))]
fn validate_android_context_initialized(initialized: bool) -> Result<(), String> {
    if initialized {
        Ok(())
    } else {
        Err("Android application context was not initialized".to_string())
    }
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
    use super::validate_android_context_initialized;

    #[test]
    fn native_key_store_context_gate_fails_closed_before_initialization() {
        let error = validate_android_context_initialized(false)
            .expect_err("an uninitialized Android context must never open the native key store");
        assert_eq!(error, "Android application context was not initialized");
        assert!(validate_android_context_initialized(true).is_ok());
    }
}
