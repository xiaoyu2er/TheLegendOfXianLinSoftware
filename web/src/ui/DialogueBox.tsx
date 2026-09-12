import { dialogueAssetId, headAssetId } from '../assets/ids'
import { resolveAsset } from '../assets/resolve'
import type { DialogueState } from '../state/dialogue'
import {
  BASELINE_TO_TOP,
  BOX_HEIGHT,
  BOX_WIDTH,
  CELL_HEIGHT,
  FONT_SIZE,
  NAME_FONT_SIZE,
  boxPatch,
  headRect,
  nameBaselineY,
  namePlateRect,
  textCells,
  waitIconRect,
} from './dialogueLayout'

/**
 * 对话框（xl-9bd.10）。**真 DOM，不画进画布。**
 *
 * 原版把界面画进画布是当年 Swing 组件太丑的历史包袱，不是要继承的设计：
 * 画进画布的文字选不中、读屏读不到、缩放糊、换字体要改绘制代码。这里叠在
 * 舞台的 overlay 层里（`stage/Stage.tsx`），overlay 已经是一个 1024×640 的
 * 逻辑坐标系并整体跟着舞台缩放，所以下面所有的数字都可以照抄原版。
 *
 * 摆位全部来自 `dialogueLayout.ts`（对着 `Dialogue.drawDialogue` 逐行核过），
 * 这里只负责把矩形贴成 `div`。**一个像素都不在这里现算** —— 现算的那些数字
 * 就没人对得上原版了。
 *
 * 状态从 `world.dialogue` 来，这个组件**只读**。逐字游标是世界状态的一部分，
 * 由 `state/dialogue.ts` 推进并逐 tick 对着真值断言，不在渲染层里跑计时器。
 */
export interface DialogueBoxProps {
  readonly dialogue: DialogueState
}

export function DialogueBox({ dialogue }: DialogueBoxProps) {
  // 对话框没开着就什么都不画。原版 `paint()` 里那句
  // `if (dialogueEvent.isSpeaking || npcEvent.isOral) dialogue.drawDialogue(g)`。
  if (!dialogue.speaking && !dialogue.oral) return null

  const box = boxPatch(dialogue)
  const head = headRect(dialogue)
  const plate = namePlateRect(dialogue)
  const icon = waitIconRect(dialogue)
  const cells = textCells(dialogue)

  return (
    <div className="dialogue" data-testid="dialogue" aria-live="polite">
      {/* @exception ADR-0001#screen-reader-text —— 原版的字全在画布里，读屏读不到。 */}
      {/* 读屏与测试要的是整句话，不是 80 个绝对定位的字。 */}
      <p className="dialogue-transcript">
        {dialogue.name === null || dialogue.type !== 1 ? null : `${dialogue.name} `}
        {dialogue.sentence ?? ''}
      </p>
      {box ? (
        <div
          className="dialogue-box"
          data-testid="dialogue-box"
          style={{
            left: `${box.x}px`,
            top: `${box.y}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            backgroundImage: `url(${resolveAsset(dialogueAssetId('box'))})`,
            backgroundPosition: `${-box.sourceX}px ${-box.sourceY}px`,
            backgroundSize: `${BOX_WIDTH}px ${BOX_HEIGHT}px`,
          }}
        />
      ) : null}
      {head ? (
        <img
          className="dialogue-head"
          data-testid="dialogue-head"
          src={resolveAsset(headAssetId(dialogue.headNo))}
          alt=""
          style={{ left: `${head.x}px`, top: `${head.y}px`, width: `${head.width}px` }}
        />
      ) : null}
      {plate ? (
        <div
          className="dialogue-name"
          style={{
            left: `${plate.x}px`,
            top: `${plate.y}px`,
            width: `${plate.width}px`,
            height: `${plate.height}px`,
            backgroundImage: `url(${resolveAsset(dialogueAssetId('name'))})`,
          }}
        >
          <span
            className="dialogue-name-text"
            style={{
              top: `${nameBaselineY(dialogue) - plate.y - NAME_FONT_SIZE * 0.8}px`,
              fontSize: `${NAME_FONT_SIZE}px`,
            }}
          >
            {dialogue.name}
          </span>
        </div>
      ) : null}
      {cells.map((cell, i) => (
        <span
          // 下标当 key：这一屏就是一个 4×20 的定长网格，第 i 个格子永远是第 i
          // 个格子。用字符当 key 会在同一屏出现两个相同的字时撞车。
          key={i}
          className={cell.red ? 'dialogue-char dialogue-char--red' : 'dialogue-char'}
          style={{
            left: `${cell.x}px`,
            top: `${cell.y - BASELINE_TO_TOP}px`,
            width: `${FONT_SIZE}px`,
            height: `${CELL_HEIGHT}px`,
            fontSize: `${FONT_SIZE}px`,
          }}
        >
          {cell.char}
        </span>
      ))}
      {icon ? (
        <img
          className="dialogue-icon"
          src={resolveAsset(dialogueAssetId(dialogue.iconFrame === 0 ? 'icon0' : 'icon1'))}
          alt=""
          style={{ left: `${icon.x}px`, top: `${icon.y}px`, width: `${icon.width}px` }}
        />
      ) : null}
    </div>
  )
}
