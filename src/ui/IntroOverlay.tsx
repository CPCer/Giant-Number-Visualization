/**
 * IntroOverlay — 首屏介绍浮层
 *
 * 在用户首次进入时展示，介绍「大数」概念与展板上数字的由来。
 * 点击按钮或浮层背景即可关闭，开始探索。
 */
export function IntroOverlay({ onStart }: { onStart: () => void }) {
  return (
    <div className="intro-overlay" onClick={onStart}>
      <div className="intro-panel" onClick={(e) => e.stopPropagation()}>
        <div className="intro-symbol">∞</div>
        <h1 className="intro-title">大数</h1>
        <div className="intro-subtitle">Giant Numbers · 攀升之路</div>

        <div className="intro-section">
          <div className="intro-section-title">什么是大数</div>
          <p className="intro-text">
            大数，是超越日常经验的数字。从 1 出发，每一步放大都跨越数个量级——万、古戈尔、葛立恒数——直到书写本身变得不可能，连宇宙中的原子也不够用来记录它的位数。
          </p>
        </div>

        <div className="intro-section">
          <div className="intro-section-title">为何是这些数</div>
          <p className="intro-text">
            海岸线上的每一个站点都是数学上严格定义的数——不是近似，不是比喻，而是有明确数学定义的对象。从古戈尔（1 后跟 100 个 0）到拉约数（集合论语言在有限符号内能定义的最大数），每一个都标记着人类向「大」迈出的一步。
          </p>
          <p className="intro-text">
            海岸线象征无限：无论走多远，它永远延伸。而这些大数就是沿途的灯塔——它们提醒我们，即便最大的数，离真正的无限仍遥不可及。
          </p>
        </div>

        <button className="intro-btn" onClick={onStart}>
          开始探索
        </button>
      </div>
    </div>
  );
}
