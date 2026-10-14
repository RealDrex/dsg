/** Push notifications are native-only; the web preview uses in-app alerts. */
export async function registerForPush(): Promise<boolean> {
  return false;
}
export function usePushRegistration() {}
