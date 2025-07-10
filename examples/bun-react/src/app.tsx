import { f } from "nodeflow";

export function App() {
  f();
  return <div>test</div>;
}

class NodeFlow<
  S extends AnyRecord = any,
  A extends FunctionRecord = any,
  E extends { beforeChange: S; change: S } & AnyRecord = any
> {
  state: S = {} as S;
  api: A = {} as A;
  _init = () => () => {};
  private initialized = false;
  private changing = false;
  private listeners = new Map<keyof E, Set<AnyFunction>>();

  init() {
    if (!this.initialized) {
      this.initialized = true;
      this._init();
    }
  }

  change(callback: () => void) {
    if (this.changing) {
      callback();
    } else {
      this.changing = true;
      this.emit("beforeChange", this.state);
      callback();
      this.emit("change", this.state);
      this.changing = false;
    }
  }

  emit<K extends keyof E>(type: K, data: E[K]) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }
  }

  on<K extends keyof E>(type: K, handler: (data: E[K]) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(handler);
    this.listeners.set(type, listeners);
    return () => this.off(type, handler);
  }

  off<K extends keyof E>(type: K, handler: (data: E[K]) => void) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this.listeners.delete(type);
      }
    }
  }
}

function create<P extends Plugin[]>(
  plugins: P,
  { autoInit = true }: { autoInit?: boolean } = {}
) {
  const instance = new NodeFlow() as InferInstance<P>;
  const inits: (() => () => void)[] = [];
  for (const plugin of plugins) {
    const { state, api, init } = plugin(instance);
    Object.assign(instance.state, state);
    Object.assign(instance.api, api);
    inits.push(init);
  }
  instance._init = () => {
    const cleanups = inits.map(init => init()).reverse();
    return () => {
      cleanups.forEach(cleanup => cleanup());
    };
  };
  if (autoInit) {
    instance.init();
  }
  return instance;
}

/////////////

const corePlugin: Plugin<
  {
    nodes: Record<string, NodeFlowNode>;
    edges: Record<string, NodeFlowEdge>;
  },
  {
    addNodes: (nodes: NodeFlowNode[]) => void;
    addEdges: (edges: NodeFlowEdge[]) => void;
  },
  {
    beforeAddNodes: NodeFlowNode[];
    addNodes: NodeFlowNode[];
    beforeAddEdges: NodeFlowEdge[];
    addEdges: NodeFlowEdge[];
  }
> = nodeflow => ({
  state: {
    nodes: {},
    edges: {}
  },
  api: {
    addNodes: (nodes: NodeFlowNode[]) => {
      nodeflow.change(() => {
        nodeflow.emit("beforeAddNodes", nodes);
        nodeflow.state = {
          ...nodeflow.state,
          nodes: {
            ...nodeflow.state.nodes,
            ...Object.fromEntries(nodes.map(node => [node.id, node]))
          }
        };
        nodeflow.emit("addNodes", nodes);
      });
    },
    addEdges: (edges: NodeFlowEdge[]) => {
      nodeflow.emit("beforeAddEdges", edges);
      nodeflow.api.setState(state => ({
        ...state,
        edges: {
          ...state.edges,
          ...Object.fromEntries(edges.map(edge => [edge.id, edge]))
        }
      }));
      nodeflow.emit("addEdges", edges);
    }
  },
  init: () => () => {}
});

/////////////

interface NodeFlowNode<Type extends string = string, Data = any> {
  type: Type;
  id: string;
  x: number;
  y: number;
  data: Data;
}

interface NodeFlowEdge<Type extends string = string, Data = any> {
  type: Type;
  id: string;
  source: string;
  target: string;
  data: Data;
}

/////////////

type AnyRecord = Record<string, any>;
type FunctionRecord = Record<string, AnyFunction>;
type AnyFunction = (...args: any[]) => any;

type PluginState<P extends Plugin> = P extends Plugin<infer S, any, any>
  ? S
  : never;

type PluginApi<P extends Plugin> = P extends Plugin<any, infer A, any>
  ? A
  : never;

type PluginEvents<P extends Plugin> = P extends Plugin<any, any, infer E>
  ? E
  : never;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

type InferState<P extends Plugin[]> = UnionToIntersection<
  PluginState<P[number]>
>;

type InferApi<P extends Plugin[]> = UnionToIntersection<PluginApi<P[number]>>;

type InferEvents<P extends Plugin[]> = UnionToIntersection<
  PluginEvents<P[number]>
> & {
  beforeChange: InferState<P>;
  change: InferState<P>;
};

interface Plugin<
  S extends AnyRecord = any,
  A extends FunctionRecord = any,
  E extends AnyRecord = any
> {
  (nodeflow: InferInstance<[this]>): {
    state: S;
    api: A;
    init: () => () => void;
    __$events?: E;
  };
}

type InferInstance<P extends Plugin[]> =
  InferState<P> extends infer S extends AnyRecord
    ? InferApi<P> extends infer A extends FunctionRecord
      ? InferEvents<P> extends infer E extends AnyRecord & {
          beforeChange: S;
          change: S;
        }
        ? NodeFlow<S, A, E>
        : never
      : never
    : never;
