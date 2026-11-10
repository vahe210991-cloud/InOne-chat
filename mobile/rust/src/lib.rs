pub mod api;
mod secure_store;

#[cfg(target_os = "android")]
mod android_context {
    use std::ffi::c_void;
    use std::sync::OnceLock;

    use jni::objects::{GlobalRef, JClass, JObject};
    use jni::JNIEnv;

    static APPLICATION_CONTEXT: OnceLock<GlobalRef> = OnceLock::new();
    static INITIALIZED: OnceLock<()> = OnceLock::new();

    /// Called from MainActivity before Flutter starts. Retaining a global
    /// reference keeps the Android application context valid for Rust/JNI.
    #[no_mangle]
    pub extern "system" fn Java_com_inone_inone_1mobile_MainActivity_init_1android(
        env: JNIEnv,
        _class: JClass,
        context: JObject,
    ) {
        INITIALIZED.get_or_init(|| {
            let global = env
                .new_global_ref(&context)
                .expect("retain Android application context");
            let vm = env.get_java_vm().expect("obtain JavaVM");
            let vm = vm.get_java_vm_pointer() as *mut c_void;
            let _ = APPLICATION_CONTEXT.set(global);
            let retained = APPLICATION_CONTEXT
                .get()
                .expect("Android application context retained");
            unsafe {
                ndk_context::initialize_android_context(
                    vm,
                    retained.as_obj().as_raw() as *mut c_void,
                );
            }
        });
    }
}
