/**
 * Where a tracked hand's pinch is: the midpoint of the thumb tip and the
 * index fingertip, in world space. Read straight from WebXR hand joints.
 */

import type { Object3D, Vector3 } from '@iwsdk/core';

interface HandContext {
  input: { xr: { getPrimaryInputSource(side: 'left' | 'right'): unknown } };
  xrFrame: XRFrame;
  xrManager: { getReferenceSpace(): XRReferenceSpace | null };
  player: Object3D;
}

const JOINTS: XRHandJoint[] = ['thumb-tip', 'index-finger-tip'];

/** Writes the pinch point of `side` to `out`. False when that hand is not tracked this frame. */
export function pinchPoint(
  context: HandContext,
  side: 'left' | 'right',
  out: Vector3,
): boolean {
  const source = context.input.xr.getPrimaryInputSource(side) as
    | XRInputSource
    | undefined;
  const hand = source?.hand;
  const frame = context.xrFrame as XRFrame | undefined;
  const space = context.xrManager.getReferenceSpace();
  if (!hand || !frame?.getJointPose || !space) return false;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const name of JOINTS) {
    const joint = hand.get(name);
    const pose = joint ? frame.getJointPose(joint, space) : null;
    if (!pose) return false;
    x += pose.transform.position.x;
    y += pose.transform.position.y;
    z += pose.transform.position.z;
  }
  context.player.localToWorld(out.set(x / 2, y / 2, z / 2));
  return true;
}
