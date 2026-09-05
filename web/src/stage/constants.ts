/**
 * 逻辑画布尺寸。与原版 `src/scene/ScenePanel.java:17-18` 的
 * `WIDTH = 1024` / `HEIGHT = 640` 一致，并且**不随窗口变化**。
 *
 * 视野范围、NPC 摆位、战斗站位都是按这个分辨率调过的：做成响应式视野
 * 就不再是移植了。窗口变大时我们只放大画面，不多给玩家看到一格地图。
 */
export const STAGE_WIDTH = 1024
export const STAGE_HEIGHT = 640
export const STAGE_ASPECT = STAGE_WIDTH / STAGE_HEIGHT
