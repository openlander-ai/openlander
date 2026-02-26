/**
 * Overlay active state management.
 *
 * Provides a centralized signal indicating whether ANY overlay/dialog is open.
 * Components use this to gate keyboard handlers — prevents background panels
 * from stealing arrow keys and other events when an overlay is active.
 *
 * This is the DIRECT import approach: components check `overlayActive()` without
 * relying on a focus prop chain through multiple component layers.
 */
import { createSignal } from 'solid-js';

const [overlayActive, setOverlayActive] = createSignal(false);

export { overlayActive, setOverlayActive };
