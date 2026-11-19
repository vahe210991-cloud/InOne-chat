import fs from 'node:fs';
import path from 'node:path';

const mainActivity = path.join(
  process.cwd(),
  'android',
  'app',
  'src',
  'main',
  'kotlin',
  'com',
  'inone',
  'inone_mobile',
  'MainActivity.kt',
);

if (!fs.existsSync(mainActivity)) {
  throw new Error(\`Flutter Android MainActivity was not generated: \${mainActivity}\`);
}

const source = \`package com.inone.inone_mobile

import android.content.Context
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.IOException

class MainActivity : FlutterActivity() {
    companion object {
        private const val STORAGE_CHANNEL = "com.inone.mls/platform_storage"

        init {
            System.loadLibrary("inone_mls_frb")
        }

        @JvmStatic
        external fun init_android(context: Context)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        init_android(applicationContext)
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        // Preserve Flutter's generated plugin registration before adding the
        // narrow app-private storage channel used by the Rust MLS adapter.
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, STORAGE_CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "applicationSupportDirectory" -> {
                        val directory = applicationContext.filesDir
                        if (!directory.isDirectory || !directory.canRead() || !directory.canWrite()) {
                            result.error(
                                "APP_SUPPORT_DIRECTORY_UNAVAILABLE",
                                "App-private storage directory is not accessible",
                                null
                            )
                        } else {
                            try {
                                result.success(directory.canonicalPath)
                            } catch (_: IOException) {
                                result.error(
                                    "APP_SUPPORT_DIRECTORY_UNAVAILABLE",
                                    "App-private storage path could not be resolved",
                                    null
                                )
                            }
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
\`;

fs.writeFileSync(mainActivity, source, 'utf8');
console.log('Configured Android native context and app-private MLS storage channel.');

const manifestPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  throw new Error(\`Flutter Android manifest was not generated: \${manifestPath}\`);
}
let manifest = fs.readFileSync(manifestPath, 'utf8');
const activityMatch = manifest.match(/<activity\\b[^>]*android:name="(?:\\.MainActivity|com\\.inone\\.inone_mobile\\.MainActivity)"[\\s\\S]*?<\\/activity>/);
if (!activityMatch) {
  throw new Error('Flutter MainActivity declaration was not found in AndroidManifest.xml');
}
if (!activityMatch[0].includes('android:scheme="inone"')) {
  const recoveryIntent = \`
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="inone" android:host="recovery" android:path="/confirm" />
            </intent-filter>\`;
  const updatedActivity = activityMatch[0].replace('</activity>', recoveryIntent + '\\n        </activity>');
  manifest = manifest.replace(activityMatch[0], updatedActivity);
  fs.writeFileSync(manifestPath, manifest, 'utf8');
}
console.log('Configured the InOne recovery deep-link intent filter.');
