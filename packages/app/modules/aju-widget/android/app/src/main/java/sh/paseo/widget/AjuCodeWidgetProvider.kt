package sh.paseo.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import sh.paseo.MainActivity
import sh.paseo.R

class AjuCodeWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (appWidgetId in appWidgetIds) {
      updateAppWidget(context, appWidgetManager, appWidgetId)
    }
  }

  companion object {
    private val ROW_IDS = intArrayOf(
      R.id.widget_row_0,
      R.id.widget_row_1,
      R.id.widget_row_2,
      R.id.widget_row_3,
    )
    private val DOT_IDS = intArrayOf(
      R.id.widget_dot_0,
      R.id.widget_dot_1,
      R.id.widget_dot_2,
      R.id.widget_dot_3,
    )
    private val TITLE_IDS = intArrayOf(
      R.id.widget_title_0,
      R.id.widget_title_1,
      R.id.widget_title_2,
      R.id.widget_title_3,
    )
    private val AGE_IDS = intArrayOf(
      R.id.widget_age_0,
      R.id.widget_age_1,
      R.id.widget_age_2,
      R.id.widget_age_3,
    )
    private val SUBTITLE_IDS = intArrayOf(
      R.id.widget_subtitle_0,
      R.id.widget_subtitle_1,
      R.id.widget_subtitle_2,
      R.id.widget_subtitle_3,
    )

    fun updateAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, AjuCodeWidgetProvider::class.java)
      val ids = manager.getAppWidgetIds(component)
      for (id in ids) {
        updateAppWidget(context, manager, id)
      }
    }

    private fun openMainIntent(context: Context): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      return PendingIntent.getActivity(
        context,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun openDeepLinkIntent(
      context: Context,
      requestCode: Int,
      deepLink: String,
    ): PendingIntent {
      if (deepLink.isBlank()) return openMainIntent(context)
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink)).apply {
        setPackage(context.packageName)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun dotDrawableFor(status: String): Int =
      when (status) {
        "permission" -> R.drawable.widget_dot_permission
        "running" -> R.drawable.widget_dot_running
        "attention" -> R.drawable.widget_dot_attention
        else -> R.drawable.widget_dot_idle
      }

    private fun updateAppWidget(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int,
    ) {
      val views = RemoteViews(context.packageName, R.layout.ajucode_widget)
      val mainPending = openMainIntent(context)
      views.setOnClickPendingIntent(R.id.widget_root, mainPending)
      views.setOnClickPendingIntent(R.id.widget_header, mainPending)

      val raw = context
        .getSharedPreferences(AjuCodeWidgetModule.PREFS_NAME, Context.MODE_PRIVATE)
        .getString(AjuCodeWidgetModule.KEY_SNAPSHOT, null)

      val payload = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
      val runningCount = payload?.optInt("runningCount", 0) ?: 0
      val waitingCount = payload?.optInt("waitingCount", 0) ?: 0
      val updatedAt = payload?.optString("updatedAtLabel", "") ?: ""
      val items = payload?.optJSONArray("items") ?: JSONArray()

      val runningText = when {
        runningCount == 0 -> "Au repos"
        runningCount == 1 -> "1 en cours"
        else -> "$runningCount en cours"
      }
      views.setTextViewText(R.id.widget_running_badge, runningText)
      views.setImageViewResource(
        R.id.widget_running_dot,
        if (runningCount > 0) R.drawable.widget_dot_running else R.drawable.widget_dot_idle,
      )

      if (waitingCount > 0) {
        views.setViewVisibility(R.id.widget_waiting_badge, View.VISIBLE)
        views.setTextViewText(
          R.id.widget_waiting_badge,
          if (waitingCount == 1) "1 en attente" else "$waitingCount en attente",
        )
      } else {
        views.setViewVisibility(R.id.widget_waiting_badge, View.GONE)
      }

      views.setTextViewText(R.id.widget_updated_at, updatedAt)

      val rowCount = minOf(items.length(), ROW_IDS.size)
      if (rowCount == 0) {
        views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
        for (i in ROW_IDS.indices) {
          views.setViewVisibility(ROW_IDS[i], View.GONE)
        }
      } else {
        views.setViewVisibility(R.id.widget_empty, View.GONE)
        for (i in ROW_IDS.indices) {
          if (i < rowCount) {
            val item = items.getJSONObject(i)
            val title = item.optString("title", "Session")
            val subtitle = item.optString("subtitle", "")
            val status = item.optString("status", "idle")
            val age = item.optString("age", "")
            val deepLink = item.optString("deepLink", "")

            views.setViewVisibility(ROW_IDS[i], View.VISIBLE)
            views.setImageViewResource(DOT_IDS[i], dotDrawableFor(status))
            views.setTextViewText(TITLE_IDS[i], title)
            views.setTextViewText(AGE_IDS[i], age)
            views.setTextViewText(SUBTITLE_IDS[i], subtitle)
            views.setViewVisibility(
              SUBTITLE_IDS[i],
              if (subtitle.isNotBlank()) View.VISIBLE else View.GONE,
            )
            views.setOnClickPendingIntent(
              ROW_IDS[i],
              openDeepLinkIntent(context, appWidgetId * 10 + i + 1, deepLink),
            )
          } else {
            views.setViewVisibility(ROW_IDS[i], View.GONE)
          }
        }
      }

      appWidgetManager.updateAppWidget(appWidgetId, views)
    }
  }
}
