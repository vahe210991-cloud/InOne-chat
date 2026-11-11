pub mod api;
mod secure_store;

#[cfg(target_os = "android")]
mod android_context {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    use jni::objects::{GlobalRef, JClass, JObject};
    use jni::JNIEnv;

    static APPLICATION_CONTEXT: OnceLock<GlobalRef> = OnceLock::new();
    static INITIALIZED: OnceLock<Result<(), String>> = OnceLock::new();

    /// Called from MainActivity before Flutter starts. Retaining a global
    /// reference keeps the Android application context valid for Rust/JNI.
    #[no_mangle]
    pub extern "system" fn Java_com_inone_inone_1mobile_MainActivity_init_1android(
        env: JNIEnv,
        _class: JClass,
        context: JObject,
    ) {
        let _ = INITIALIZED.get_or_init(|| {
            let global = env
                .new_global_ref(&context)
                .map_err(|error| format!("retain Android application context: {error}"))?;
            let vm = env
                .get_java_vm()
                .map_err(|error| format!("obtain JavaVM: {error}"))?;
            let vm = vm.get_java_vm_pointer() as *mut c_void;
            let _ = APPLICATION_CONTEXT.set(global);
            let retained = APPLICATION_CONTEXT
                .get()
                .ok_or_else(|| "Android application context was not retained".to_string())?;
            unsafe {
                ndk_context::initialize_android_context(
                    vm,
                    retained.as_obj().as_raw() as *mut c_void,
                );
            }
            Ok(())
        });
    }

    pub fn ensure_initialized() -> Result<(), String> {
        INITIALIZED
            .get()
            .cloned()
            .unwrap_or_else(|| Err("Android application context was not initialized".to_string()))
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
