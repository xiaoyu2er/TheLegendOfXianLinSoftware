/**
 * 放大方式。`sharp` 是默认值 —— 2026-09-07 人工裁定（xl-h1f）。
 *
 * 判据是并排看同一个素材文件在缩放 1.48（1512 宽视口）下的两种渲染，唯一
 * 变量是 `image-rendering`：**人物上锐利明显更清楚**，平滑把宋大仁 39×63 与
 * 清洁工 32×64（M1 终验时被人类玩家点名的那两个）的五官、衣纹、扫把糊成
 * 一团；**背景上两者差别很小**，锐利没有把大地图弄难看 —— 改默认值的主要
 * 风险本来就在背景，实测它不成立。
 *
 * 这一句替掉的旧理由是「原版素材是手绘位图而非像素画，双线性更接近它在
 * CRT / LCD 上原本的样子」。那是个未经验证的推断：原版在当年那些显示器上
 * 到底什么样，今天已经没有办法再测到。现在写在这里的是真看过的东西。
 *
 * ⚠️ 用相邻像素梯度均值这个粗糙指标量，两者只差 3.8%（xl-h1f 票面记的实测）
 * —— **别拿那个数当结论**，它严重低估了肉眼所见。这条留在这里，是因为下一个
 * 想「用指标验证一下」的人会重新算出同一个数，然后得出相反的结论。
 *
 * `smooth` 留给偏好柔边的玩家；UI 右下角的按钮两种都能切，这里定的只是默认值。
 */
export type ScalingMode = 'smooth' | 'sharp'

export const DEFAULT_SCALING_MODE: ScalingMode = 'sharp'

/** 映射到 CSS `image-rendering`，浏览器据此选择放大插值。 */
export function imageRenderingFor(mode: ScalingMode): 'auto' | 'pixelated' {
  return mode === 'sharp' ? 'pixelated' : 'auto'
}
