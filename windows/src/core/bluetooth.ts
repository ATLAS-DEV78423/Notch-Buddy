export interface BluetoothEvent {
  id: string;
  connected: boolean;
}

/** Keep the single worker round-trip serialized; it owns one stdin/stdout pair. */
export function canStartBluetoothAction(pendingId: string, id: string): boolean {
  return pendingId === "" || pendingId === id;
}

export function isCurrentBluetoothRequest(request: number, current: number): boolean {
  return request === current;
}

/** A full device refresh is authoritative; ignore delayed events for old rows/states. */
export function acceptsBluetoothEvent(
  device: { id: string; connected: boolean },
  event: BluetoothEvent,
): boolean {
  return device.id === event.id && device.connected === event.connected;
}
