/**
 * Expression Parser — 表达式解析器
 *
 * 手写递归下降解析器，将芯片序列或文本表达式转换为 AST。
 * 不使用 eval()，安全可靠。
 *
 * 支持的语法：
 *   数字:     1, 100, 10000
 *   加法:     a + b
 *   乘法:     a × b  (或 a * b)
 *   幂运算:   a ^ b  (右结合)
 *   阶乘:     n!
 *   幂塔:     a ^^ b  (迭幂)
 *   箭头:     a ↑↑↑ b  (高德纳箭头, 右结合)
 *   括号:     (a + b) ^ c
 *   命名常量: googol, googolplex, graham, tree3, rayo
 *   函数:     factorial(n), tower(a, h)
 *
 * 优先级（从低到高）：
 *   +       加法
 *   × *     乘法
 *   ^^      迭幂
 *   ↑+      箭头（右结合）
 *   ^       幂运算（右结合）
 *   !       阶乘（后缀）
 *   ()      括号
 */

// ── AST 节点 ──

export type ExprNode =
  | { type: 'num'; value: number }
  | { type: 'named'; id: string }
  | { type: 'binop'; op: BinOp; left: ExprNode; right: ExprNode }
  | { type: 'factorial'; operand: ExprNode }
  | { type: 'arrow'; left: ExprNode; arrows: number; right: ExprNode }
  | { type: 'func'; name: string; args: ExprNode[] };

export type BinOp = 'add' | 'mul' | 'pow' | 'tetrate';

// ── 芯片类型（UI 层使用） ──

export type ChipType =
  | 'num'
  | 'add'
  | 'mul'
  | 'pow'
  | 'factorial'
  | 'tetrate'
  | 'arrow1'
  | 'arrow2'
  | 'arrow3'
  | 'arrow4'
  | 'lparen'
  | 'rparen'
  | 'named'
  | 'func_factorial'
  | 'func_tower';

export interface Chip {
  type: ChipType;
  label: string;
  /** num 芯片的值 */
  value?: number;
  /** named 芯片的 id */
  id?: string;
}

// ── Tokenizer ──

interface Token {
  type:
    | 'number'
    | 'plus'
    | 'star'
    | 'caret'
    | 'doublecaret'
    | 'bang'
    | 'arrow'
    | 'lparen'
    | 'rparen'
    | 'comma'
    | 'ident';
  value: string;
  /** arrow 类型的箭头数 */
  arrows?: number;
  /** number 类型的数值 */
  num?: number;
}

const NAMED_CONSTANTS = new Set([
  'googol', 'googolplex', 'graham', 'tree3', 'rayo',
]);

const FUNCTIONS = new Set(['factorial', 'tower']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.trim();

  while (i < s.length) {
    const c = s[i];

    // 跳过空白
    if (/\s/.test(c)) { i++; continue; }

    // 数字
    if (/[0-9]/.test(c)) {
      let num = '';
      while (i < s.length && /[0-9]/.test(s[i])) { num += s[i]; i++; }
      tokens.push({ type: 'number', value: num, num: parseInt(num, 10) });
      continue;
    }

    // 标识符（命名常量、函数名）
    if (/[a-zA-Z_]/.test(c)) {
      let ident = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) { ident += s[i]; i++; }
      tokens.push({ type: 'ident', value: ident.toLowerCase() });
      continue;
    }

    // 运算符
    if (c === '+') { tokens.push({ type: 'plus', value: '+' }); i++; continue; }
    if (c === '*' || c === '×') { tokens.push({ type: 'star', value: '*' }); i++; continue; }
    if (c === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (c === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }
    if (c === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue; }
    if (c === '!') { tokens.push({ type: 'bang', value: '!' }); i++; continue; }

    // 箭头 ↑
    if (c === '↑') {
      let count = 0;
      while (i < s.length && s[i] === '↑') { count++; i++; }
      tokens.push({ type: 'arrow', value: '↑'.repeat(count), arrows: count });
      continue;
    }

    // ^ 和 ^^
    if (c === '^') {
      if (s[i + 1] === '^') {
        tokens.push({ type: 'doublecaret', value: '^^' });
        i += 2;
      } else {
        tokens.push({ type: 'caret', value: '^' });
        i++;
      }
      continue;
    }

    throw new Error(`无法识别的字符: "${c}" 在位置 ${i}`);
  }

  return tokens;
}

// ── Parser ──

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(): Token {
    if (this.pos >= this.tokens.length) throw new Error('意外的输入结束');
    return this.tokens[this.pos++];
  }

  private expect(type: string): Token {
    const t = this.peek();
    if (!t || t.type !== type) throw new Error(`期望 ${type}，得到 ${t?.type ?? 'EOF'}`);
    return this.consume();
  }

  /** 入口：解析完整表达式 */
  parse(): ExprNode {
    const node = this.parseAddition();
    if (this.pos < this.tokens.length) {
      throw new Error(`多余的 token: ${this.tokens[this.pos].value}`);
    }
    return node;
  }

  // 优先级从低到高

  /** addition: multiplication ('+' multiplication)* */
  private parseAddition(): ExprNode {
    let left = this.parseMultiplication();
    while (this.peek()?.type === 'plus') {
      this.consume();
      const right = this.parseMultiplication();
      left = { type: 'binop', op: 'add', left, right };
    }
    return left;
  }

  /** multiplication: tetration ('×' tetration)* */
  private parseMultiplication(): ExprNode {
    let left = this.parseTetration();
    while (this.peek()?.type === 'star') {
      this.consume();
      const right = this.parseTetration();
      left = { type: 'binop', op: 'mul', left, right };
    }
    return left;
  }

  /** tetration: arrow ('^^' arrow)* — 左结合 */
  private parseTetration(): ExprNode {
    let left = this.parseArrow();
    while (this.peek()?.type === 'doublecaret') {
      this.consume();
      const right = this.parseArrow();
      left = { type: 'binop', op: 'tetrate', left, right };
    }
    return left;
  }

  /** arrow: power ('↑+' power)? — 右结合 */
  private parseArrow(): ExprNode {
    const left = this.parsePower();
    const t = this.peek();
    if (t?.type === 'arrow') {
      this.consume();
      const right = this.parseArrow(); // 右结合
      return { type: 'arrow', left, arrows: t.arrows!, right };
    }
    return left;
  }

  /** power: factorial ('^' power)? — 右结合 */
  private parsePower(): ExprNode {
    const left = this.parseFactorial();
    const t = this.peek();
    if (t?.type === 'caret') {
      this.consume();
      const right = this.parsePower(); // 右结合
      return { type: 'binop', op: 'pow', left, right };
    }
    return left;
  }

  /** factorial: primary ('!')* — 后缀 */
  private parseFactorial(): ExprNode {
    let node = this.parsePrimary();
    while (this.peek()?.type === 'bang') {
      this.consume();
      node = { type: 'factorial', operand: node };
    }
    return node;
  }

  /** primary: number | named | func(args) | '(' addition ')' */
  private parsePrimary(): ExprNode {
    const t = this.peek();
    if (!t) throw new Error('意外的输入结束');

    if (t.type === 'number') {
      this.consume();
      return { type: 'num', value: t.num! };
    }

    if (t.type === 'lparen') {
      this.consume();
      const node = this.parseAddition();
      this.expect('rparen');
      return node;
    }

    if (t.type === 'ident') {
      this.consume();
      const name = t.value;

      if (FUNCTIONS.has(name)) {
        // 函数调用
        this.expect('lparen');
        const args: ExprNode[] = [this.parseAddition()];
        while (this.peek()?.type === 'comma') {
          this.consume();
          args.push(this.parseAddition());
        }
        this.expect('rparen');
        return { type: 'func', name, args };
      }

      if (NAMED_CONSTANTS.has(name)) {
        return { type: 'named', id: name };
      }

      throw new Error(`未知标识符: ${name}`);
    }

    throw new Error(`意外的 token: ${t.value}`);
  }
}

// ── 公共 API ──

/** 解析文本表达式为 AST */
export function parseExpression(input: string): ExprNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error('空表达式');
  return new Parser(tokens).parse();
}

/** 将芯片序列转为文本表达式 */
export function chipsToText(chips: Chip[]): string {
  return chips.map((c) => {
    switch (c.type) {
      case 'num': return c.value?.toString() ?? '0';
      case 'add': return '+';
      case 'mul': return '*';
      case 'pow': return '^';
      case 'factorial': return '!';
      case 'tetrate': return '^^';
      case 'arrow1': return '↑';
      case 'arrow2': return '↑↑';
      case 'arrow3': return '↑↑↑';
      case 'arrow4': return '↑↑↑↑';
      case 'lparen': return '(';
      case 'rparen': return ')';
      case 'named': return c.id ?? '';
      case 'func_factorial': return 'factorial(';
      case 'func_tower': return 'tower(';
    }
  }).join(' ');
}

/** 从芯片序列解析 AST */
export function parseChips(chips: Chip[]): ExprNode {
  const text = chipsToText(chips);
  return parseExpression(text);
}

/** 将 AST 转回可读文本（用于显示） */
export function astToText(node: ExprNode): string {
  switch (node.type) {
    case 'num': return node.value.toString();
    case 'named': return node.id;
    case 'binop':
      return `${astToText(node.left)} ${opSymbol(node.op)} ${astToText(node.right)}`;
    case 'factorial':
      return `${astToText(node.operand)}!`;
    case 'arrow':
      return `${astToText(node.left)} ${'↑'.repeat(node.arrows)} ${astToText(node.right)}`;
    case 'func':
      return `${node.name}(${node.args.map(astToText).join(', ')})`;
  }
}

function opSymbol(op: BinOp): string {
  switch (op) {
    case 'add': return '+';
    case 'mul': return '×';
    case 'pow': return '^';
    case 'tetrate': return '^^';
  }
}
