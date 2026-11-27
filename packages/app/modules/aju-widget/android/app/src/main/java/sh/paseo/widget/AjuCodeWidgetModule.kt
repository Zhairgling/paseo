package sh.paseo.widget

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AjuCodeWidgetModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AjuCodeWidget"

  @ReactMethod
  fun updateSnapshot(json: String) {
    reactContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SNAPSHOT, json)
      .apply()
    AjuCodeWidgetProvider.updateAllWidgets(reactContext)
  }

  companion object {
    const val PREFS_NAME = "ajucode_widget"
    const val KEY_SNAPSHOT = "snapshot"
  }
}
