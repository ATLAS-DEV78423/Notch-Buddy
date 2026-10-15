import assert from "node:assert/strict";

const { canStartBluetoothAction, isCurrentBluetoothRequest, acceptsBluetoothEvent } = await import("./bluetooth.ts");

const device = { id: "bth://mouse/42", name: "Mouse", type: "mouse", battery: 80, connected: true, can_connect: false };

assert.equal(canStartBluetoothAction("", device.id), true);
assert.equal(canStartBluetoothAction(device.id, "bth://headphones/7"), false, "a second device action cannot race the first");
assert.equal(canStartBluetoothAction(device.id, device.id), true);
assert.equal(isCurrentBluetoothRequest(2, 2), true);
assert.equal(isCurrentBluetoothRequest(1, 2), false, "a stale refresh response is ignored");

assert.equal(
  acceptsBluetoothEvent(device, { id: device.id, connected: true }),
  true,
  "an event for the current stable id and state is accepted",
);
assert.equal(
  acceptsBluetoothEvent(device, { id: "bth://mouse/old", connected: false }),
  false,
  "a stale event for another device is ignored",
);
assert.equal(
  acceptsBluetoothEvent(device, { id: device.id, connected: false }),
  false,
  "an event that disagrees with the refreshed list is ignored",
);

console.log("bluetooth frontend identity/concurrency OK");
