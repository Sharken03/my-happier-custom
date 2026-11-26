package dev.happier.fileactions

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.hermes.instrumentation.HermesSamplingProfiler
import java.io.File

/**
 * Diagnostic build only: starts the Hermes sampling profiler and writes its samples as a Chrome
 * trace, so a release APK can show where JavaScript time goes. Driven from adb:
 *   am broadcast -n <package>/dev.happier.fileactions.HermesProfileReceiver --es cmd start
 *   am broadcast -n <package>/dev.happier.fileactions.HermesProfileReceiver --es cmd dump --es name x.json
 * The trace goes to the app's external files folder, which adb can read.
 */
class HermesProfileReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (val cmd = intent.getStringExtra("cmd")) {
      "start" -> {
        HermesSamplingProfiler.enable()
        Log.i(TAG, "sampling profiler started")
      }
      "dump" -> {
        val dir = context.getExternalFilesDir(null) ?: context.filesDir
        val name = intent.getStringExtra("name")?.takeIf { it.matches(Regex("[A-Za-z0-9._-]+")) }
          ?: "hermes-profile.json"
        val file = File(dir, name)
        HermesSamplingProfiler.dumpSampledTraceToFile(file.absolutePath)
        Log.i(TAG, "trace written to ${file.absolutePath} (${file.length()} bytes)")
      }
      else -> Log.w(TAG, "unknown cmd: $cmd")
    }
  }

  private companion object {
    const val TAG = "HappierHermesProfile"
  }
}
