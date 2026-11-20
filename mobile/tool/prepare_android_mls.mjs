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
  'app',
  'MainActivity.kt',
);

if (!fs.existsSync(mainActivity)) {
  throw new Error(`Flutter Android MainActivity was not generated: ${mainActivity}`);
}

const source = `package com.inone.app

import android.content.Context
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    companion object {
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
}
`;

fs.writeFileSync(mainActivity, source, 'utf8');
console.log('Configured Android NDK context initialization for the OpenMLS Rust library.');
const manifestPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Flutter Android manifest was not generated: ${manifestPath}`);
}
let manifest = fs.readFileSync(manifestPath, 'utf8');
const activityMatch = manifest.match(/<activity\b[^>]*android:name="(?:\.MainActivity|com\.inone\.inone_mobile\.MainActivity)"[\s\S]*?<\/activity>/);
if (!activityMatch) {
  throw new Error('Flutter MainActivity declaration was not found in AndroidManifest.xml');
}
if (!activityMatch[0].includes('android:scheme="inone"')) {
  const recoveryIntent = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="inone" android:host="recovery" android:path="/confirm" />
            </intent-filter>`;
  const updatedActivity = activityMatch[0].replace('</activity>', recoveryIntent + '\n        </activity>');
  manifest = manifest.replace(activityMatch[0], updatedActivity);
  fs.writeFileSync(manifestPath, manifest, 'utf8');
}
console.log('Configured the InOne recovery deep-link intent filter.');
