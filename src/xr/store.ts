import { createXRStore } from '@react-three/xr'

// foveation 0 = sharpest periphery, which matters for reading small lettering
// (three's WebXR default is max foveation, i.e. blurry edges).
//
// Two useful defaults we rely on rather than configure:
//  - the origin reference space is already floor-relative ('local-floor') in xr v6.
//  - `emulate` defaults to "metaQuest3" and only kicks in when WebXR is
//    unsupported on localhost — so the desktop gets an emulated headset for the
//    fast inner loop (adb isn't available on this Mac), while the real Quest
//    browser still gets a genuine immersive-vr session.
export const xrStore = createXRStore({
  foveation: 0,
})

// End the immersive session and drop back to the 2D browser.
export function exitVR() {
  void xrStore.getState().session?.end()
}
