import * as Notifications from "expo-notifications";
import type { NotificationOpenSource, NotificationTap } from "./source";

function toTap(response: Notifications.NotificationResponse): NotificationTap {
  return {
    id: response.notification.request.identifier,
    data: response.notification.request.content.data,
  };
}

export function createNotificationOpenSource(): NotificationOpenSource {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  return {
    subscribe(onTap) {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
          return;
        }
        onTap(toTap(response));
      });
      return () => subscription.remove();
    },
    async takeLaunchTap() {
      const response = await Notifications.getLastNotificationResponseAsync();
      return response ? toTap(response) : null;
    },
    acknowledge() {
      Notifications.clearLastNotificationResponse();
    },
  };
}
