import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type TestNode = {
  type: unknown;
  props: Record<string, any>;
};

export function compileCommonJs<T>(sourceUrl: { toString(): string }, mocks: Record<string, unknown>): T {
  const sourcePath = fileURLToPath(sourceUrl.toString());
  const require = createRequire(sourcePath);
  const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;

  new Function('require', 'exports', compiled)((id: string) => {
    if (id in mocks) return mocks[id];
    return require(id.startsWith('.') ? `${id}.ts` : id);
  }, exports);

  return exports;
}

type EffectSlot = {
  cleanup?: () => void;
  dependencies?: readonly unknown[];
  effect?: () => void | (() => void);
  pending: boolean;
};

function dependenciesChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
  if (previous === undefined || next === undefined || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

export function createHookHarness() {
  const hookValues: unknown[] = [];
  const effects = new Map<number, EffectSlot>();
  let hookIndex = 0;
  let renderRoot: (() => unknown) | undefined;
  let output: unknown;
  let dirty = false;
  let mounted = false;
  let stateUpdateCount = 0;

  const react = {
    Fragment: 'Fragment',
    createContext: () => {
      const context: { current?: unknown; Provider?: (props: { value: unknown; children?: unknown }) => unknown } = {};
      function ContextProvider({ value, children }: { value: unknown; children?: unknown }) {
        context.current = value;
        return children ?? null;
      }
      context.Provider = ContextProvider;
      return context;
    },
    createElement: (type: unknown, props: Record<string, any> | null, ...children: unknown[]) => {
      const childValue = children.length <= 1 ? children[0] : children;
      if (typeof type === 'function') return type({ ...(props ?? {}), children: childValue });
      return createElement(type, props, ...children);
    },
    useCallback: <T>(callback: T, dependencies: readonly unknown[]) =>
      react.useMemo(() => callback, dependencies),
    useContext: (context: { current?: unknown }) => context.current,
    useEffect: (effect: () => void | (() => void), dependencies?: readonly unknown[]) => {
      const index = hookIndex++;
      const slot = effects.get(index) ?? { pending: false };
      if (dependenciesChanged(slot.dependencies, dependencies)) {
        slot.effect = effect;
        slot.dependencies = dependencies;
        slot.pending = true;
      }
      effects.set(index, slot);
    },
    useMemo: <T>(factory: () => T, dependencies: readonly unknown[]) => {
      const index = hookIndex++;
      const previous = hookValues[index] as { value: T; dependencies: readonly unknown[] } | undefined;
      if (!previous || dependenciesChanged(previous.dependencies, dependencies)) {
        const next = { value: factory(), dependencies };
        hookValues[index] = next;
        return next.value;
      }
      return previous.value;
    },
    useRef: <T>(initial: T) => {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = { current: initial };
      return hookValues[index] as { current: T };
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = hookIndex++;
      if (!(index in hookValues)) {
        hookValues[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      const setValue = (next: T | ((current: T) => T)) => {
        stateUpdateCount += 1;
        const current = hookValues[index] as T;
        const value = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
        if (!Object.is(current, value)) {
          hookValues[index] = value;
          dirty = true;
        }
      };
      return [hookValues[index] as T, setValue] as const;
    },
  };

  const render = () => {
    if (!mounted || !renderRoot) return output;
    let attempts = 0;
    do {
      if (attempts++ > 25) throw new Error('Hook harness exceeded its rerender limit');
      dirty = false;
      hookIndex = 0;
      output = renderRoot();
      for (const slot of effects.values()) {
        if (!slot.pending) continue;
        slot.pending = false;
        slot.cleanup?.();
        const cleanup = slot.effect?.();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    } while (dirty);
    return output;
  };

  return {
    react,
    mount(root: () => unknown) {
      renderRoot = root;
      mounted = true;
      return render();
    },
    render,
    get output() {
      return output;
    },
    get stateUpdateCount() {
      return stateUpdateCount;
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      for (const slot of effects.values()) slot.cleanup?.();
    },
  };
}

export function createElement(type: unknown, props: Record<string, any> | null, ...children: unknown[]): TestNode {
  return {
    type,
    props: {
      ...(props ?? {}),
      children: children.length <= 1 ? children[0] : children,
    },
  };
}

export function findNode(root: unknown, predicate: (node: TestNode) => boolean): TestNode | undefined {
  if (Array.isArray(root)) {
    for (const child of root) {
      const match = findNode(child, predicate);
      if (match) return match;
    }
    return undefined;
  }

  if (!root || typeof root !== 'object' || !('props' in root)) return undefined;
  const node = root as TestNode;
  if (predicate(node)) return node;
  return findNode(node.props.children, predicate);
}

export function nodeText(root: unknown): string {
  if (typeof root === 'string' || typeof root === 'number') return String(root);
  if (Array.isArray(root)) return root.map(nodeText).join('');
  if (!root || typeof root !== 'object' || !('props' in root)) return '';
  return nodeText((root as TestNode).props.children);
}

export function flattenStyle(style: unknown): Record<string, any> {
  if (!Array.isArray(style)) return (style ?? {}) as Record<string, any>;
  return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
}
