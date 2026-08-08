/**
 * Expression Forge — 表达式锻造炉
 *
 * 芯片式表达式构建器，支持文本直接输入 + 快捷芯片插入。
 * 实时解析并求值，预览量级、描述、海岸线位置和相邻站点。
 * 点击「锻造」后，将结果交给 App 在海岸线上生成标记并触发瀑布动画。
 */
import { useState, useRef, useMemo } from 'react';
import { parseExpression, astToText } from '../engine/expressionParser';
import { evaluate } from '../engine/evaluator';
import {
  describeMagnitude,
  scaleDescription,
  toScaleLevel,
  type Magnitude,
  type StationRef,
} from '../engine/magnitude';

interface Props {
  stationRefs: StationRef[];
  onForge: (magnitude: Magnitude, scaleLevel: number, expressionText: string) => void;
  onClose: () => void;
}

// ── 芯片定义 ──

interface ChipDef {
  text: string;
  display: string;
}

const CHIP_GROUPS: { label: string; chips: ChipDef[] }[] = [
  {
    label: '数字',
    chips: [
      { text: '1', display: '1' },
      { text: '2', display: '2' },
      { text: '3', display: '3' },
      { text: '10', display: '10' },
      { text: '100', display: '100' },
      { text: '1000', display: '10³' },
      { text: '10000', display: '10⁴' },
    ],
  },
  {
    label: '运算',
    chips: [
      { text: ' + ', display: '+' },
      { text: ' × ', display: '×' },
      { text: ' ^ ', display: '^' },
      { text: '!', display: '!' },
      { text: ' ^^ ', display: '^^' },
    ],
  },
  {
    label: '箭头',
    chips: [
      { text: ' ↑ ', display: '↑' },
      { text: ' ↑↑ ', display: '↑↑' },
      { text: ' ↑↑↑ ', display: '↑↑↑' },
      { text: ' ↑↑↑↑ ', display: '↑↑↑↑' },
    ],
  },
  {
    label: '命名',
    chips: [
      { text: 'googol', display: '古戈尔' },
      { text: 'googolplex', display: '古戈尔普勒克斯' },
      { text: 'graham', display: '葛立恒数' },
      { text: 'tree3', display: 'TREE(3)' },
      { text: 'rayo', display: '拉约数' },
    ],
  },
  {
    label: '括号',
    chips: [
      { text: '(', display: '(' },
      { text: ')', display: ')' },
    ],
  },
];

const EXAMPLES = [
  '10 ^ 100',
  '3 ↑↑↑ 3',
  '10 ^^ 4',
  '100 !',
  '2 ↑↑↑↑ 3',
];

// ── 求值结果类型 ──

type EvalResult =
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      mag: Magnitude;
      scaleLevel: number;
      desc: string;
      scaleDesc: string;
      below: StationRef | null;
      above: StationRef | null;
      astText: string;
    };

// ── 组件 ──

export function ExpressionForge({ stationRefs, onForge, onClose }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const evaluation = useMemo<EvalResult>(() => {
    if (!text.trim()) return { status: 'empty' };
    try {
      const ast = parseExpression(text);
      const mag = evaluate(ast);
      const scaleLevel = toScaleLevel(mag, stationRefs);
      const desc = describeMagnitude(mag);
      const scaleDesc = scaleDescription(mag);
      const astText = astToText(ast);

      // 查找相邻站点
      const sorted = [...stationRefs].sort((a, b) => a.scaleLevel - b.scaleLevel);
      let below: StationRef | null = null;
      let above: StationRef | null = null;
      for (const s of sorted) {
        if (s.scaleLevel <= scaleLevel) below = s;
        if (s.scaleLevel > scaleLevel && !above) {
          above = s;
          break;
        }
      }

      return { status: 'ok', mag, scaleLevel, desc, scaleDesc, below, above, astText };
    } catch (e) {
      return { status: 'error', message: (e as Error).message };
    }
  }, [text, stationRefs]);

  const insertText = (insertion: string) => {
    const input = inputRef.current;
    if (!input) {
      setText((prev) => prev + insertion);
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + insertion + text.slice(end);
    const newPos = start + insertion.length;
    setText(newText);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newPos, newPos);
    });
  };

  const handleBackspace = () => {
    const input = inputRef.current;
    if (!input) {
      setText((prev) => prev.slice(0, -1));
      return;
    }
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    if (start !== end) {
      setText(text.slice(0, start) + text.slice(end));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(start, start);
      });
    } else if (start > 0) {
      setText(text.slice(0, start - 1) + text.slice(end));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(start - 1, start - 1);
      });
    }
  };

  const handleClear = () => setText('');

  const handleForge = () => {
    if (evaluation.status !== 'ok') return;
    onForge(evaluation.mag, evaluation.scaleLevel, evaluation.astText);
  };

  return (
    <div className="forge-panel">
      <div className="forge-header">
        <span className="forge-title">表达式锻造炉</span>
        <button className="forge-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <input
        ref={inputRef}
        className="forge-input"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入表达式，如 10^100 或 3↑↑↑3"
        spellCheck={false}
        autoComplete="off"
      />

      <div className="forge-chips">
        {CHIP_GROUPS.map((group) => (
          <div key={group.label} className="forge-chip-row">
            <span className="forge-chip-label">{group.label}</span>
            <div className="forge-chip-group">
              {group.chips.map((chip) => (
                <button
                  key={chip.text}
                  className="forge-chip"
                  onClick={() => insertText(chip.text)}
                >
                  {chip.display}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="forge-edit-row">
        <button className="forge-edit-btn" onClick={handleBackspace}>
          ⌫ 删除
        </button>
        <button className="forge-edit-btn" onClick={handleClear}>
          清空
        </button>
      </div>

      <div className="forge-examples">
        <span className="forge-chip-label">示例</span>
        <div className="forge-chip-group">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="forge-example" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className="forge-preview">
        {evaluation.status === 'empty' && (
          <div className="forge-preview-empty">构建你的表达式，预览将在此显示...</div>
        )}
        {evaluation.status === 'error' && (
          <div className="forge-preview-error">⚠ {evaluation.message}</div>
        )}
        {evaluation.status === 'ok' && (
          <>
            <div className="forge-preview-row">
              <span className="forge-preview-label">量级</span>
              <span className="forge-preview-value forge-preview-mono">
                {evaluation.desc}
              </span>
            </div>
            <div className="forge-preview-row">
              <span className="forge-preview-label">描述</span>
              <span className="forge-preview-value">{evaluation.scaleDesc}</span>
            </div>
            <div className="forge-preview-row">
              <span className="forge-preview-label">海岸线</span>
              <span className="forge-preview-value forge-preview-mono">
                scale {evaluation.scaleLevel.toFixed(2)}
              </span>
            </div>
            <div className="forge-preview-neighbors">
              {evaluation.below ? (
                <span>← {evaluation.below.name}</span>
              ) : (
                <span>← (起点)</span>
              )}
              {evaluation.above ? (
                <span>{evaluation.above.name} →</span>
              ) : (
                <span>∞ →</span>
              )}
            </div>
          </>
        )}
      </div>

      <button
        className="forge-btn"
        onClick={handleForge}
        disabled={evaluation.status !== 'ok'}
      >
        锻造此数
      </button>
    </div>
  );
}
