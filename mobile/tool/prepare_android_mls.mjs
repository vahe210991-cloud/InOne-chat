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
  throw new Error(`Flutter Android MainActivity was not generated: ${mainActivity}`);
}

const source = `package com.inone.inone_mobile

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
