export const ImpactFeedbackStyle = {
  Light: "light",
  Medium: "medium",
  Heavy: "heavy",
} as const;

export const NotificationFeedbackType = {
  Success: "success",
  Warning: "warning",
  Error: "error",
} as const;

export function impactAsync(): Promise<void> {
  return Promise.resolve();
}

export function notificationAsync(): Promise<void> {
  return Promise.resolve();
}

export function selectionAsync(): Promise<void> {
  return Promise.resolve();
}
