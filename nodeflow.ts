/**
 * A map of event names to their payload types.
 */
export type EventMap = Record<string, any>;

/**
 * A generic interface for an event emitter.
 */
export interface IEventEmitter<Events extends EventMap> {
  on<E extends keyof Events>(
    event: E,
    listener: (payload: Events[E]) => void
  ): void;
  off<E extends keyof Events>(
    event: E,
    listener: (payload: Events[E]) => void
  ): void;
  emit<E extends keyof Events>(event: E, payload: Events[E]): void;
}

/**
 * The context provided to a plugin's API factory, giving it access to the core instance's
 * capabilities in a type-safe manner.
 */
export type PluginContext<S, A, E extends EventMap> = {
  getState: () => S;
  setState: (partialState: Partial<S>) => void;
  getApi: () => A;
  emit: <K extends keyof E>(event: K, payload: E[K]) => void;
};

/**
 * The structure of a NodeFlow plugin. It's generic over its contributions.
 * We use a phantom `_events` property to carry the event types.
 */
export interface NodeFlowPlugin<
  Name extends string = string,
  S extends Record<string, any> = {},
  A extends Record<string, (...args: any[]) => any> = {},
  E extends EventMap = {}
> {
  name: Name;
  state?: S;
  api?: (context: PluginContext<any, any, any>) => A;
  _events?: E; // Phantom property for event type inference
}

/**
 * A helper function to create a strongly-typed plugin.
 * This is a curried function: the first call sets the event types,
 * and the second defines the state and API.
 *
 * @example
 * const myPlugin = definePlugin<{ 'my-event': { id: string } }>()({
 *   name: 'myPlugin',
 *   state: { myValue: 42 },
 *   api: (context) => ({
 *     myMethod: () => {
 *       context.emit('my-event', { id: '123' });
 *     }
 *   })
 * });
 */
export function definePlugin<E extends EventMap = {}>() {
  return <
    const Name extends string,
    const S extends Record<string, any>,
    // The API factory can return any shape of functions
    const A extends (context: any) => Record<string, (...args: any[]) => any>
  >(plugin: {
    name: Name;
    state?: S;
    api?: A;
  }): NodeFlowPlugin<Name, S, ReturnType<A>, E> => {
    return plugin as any;
  };
}

// Type utilities to merge properties from a tuple of plugins
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
  k: infer I
) => void
  ? I
  : never;

type PluginsState<T extends readonly NodeFlowPlugin[]> = UnionToIntersection<
  {
    [K in keyof T]: T[K] extends NodeFlowPlugin<any, infer S, any, any>
      ? S
      : {};
  }[number]
>;

type PluginsApi<T extends readonly NodeFlowPlugin[]> = UnionToIntersection<
  {
    [K in keyof T]: T[K] extends NodeFlowPlugin<any, any, infer A, any>
      ? A
      : {};
  }[number]
>;

type PluginsEvents<T extends readonly NodeFlowPlugin[]> = UnionToIntersection<
  {
    [K in keyof T]: T[K] extends NodeFlowPlugin<any, any, any, infer E>
      ? E
      : {};
  }[number]
>;

// Base definitions for a vanilla NodeFlow instance
interface CoreState {
  nodes: Record<string, { id: string; position: { x: number; y: number } }>;
  edges: Record<string, { id: string; source: string; target: string }>;
}

interface CoreApi {
  addNode: (node: CoreState["nodes"][string]) => void;
  addEdge: (edge: CoreState["edges"][string]) => void;
}

interface CoreEvents extends EventMap {
  "node:added": { nodeId: string };
  "edge:added": { edgeId: string };
  error: { message: string };
}

/**
 * The final, fully-typed NodeFlow instance.
 */
export type NodeFlowInstance<Plugins extends readonly NodeFlowPlugin[]> =
  NodeFlow<
    CoreState & PluginsState<Plugins>,
    CoreApi & PluginsApi<Plugins>,
    CoreEvents & PluginsEvents<Plugins>
  >;

class NodeFlow<
  S extends Record<string, any>,
  A extends Record<string, (...args: any[]) => any>,
  E extends EventMap
> implements IEventEmitter<E>
{
  public state: S;
  public api: A = {} as A;
  private listeners: { [K in keyof E]?: ((payload: E[K]) => void)[] } = {};

  constructor(
    initialState: S,
    apiFactories: ((context: PluginContext<S, A, E>) => Partial<A>)[]
  ) {
    this.state = initialState;

    const context: PluginContext<S, A, E> = {
      getState: () => this.state,
      setState: (partialState: Partial<S>) => {
        this.state = { ...this.state, ...partialState };
      },
      getApi: () => this.api,
      emit: this.emit.bind(this)
    };

    const allApis = apiFactories.map(factory => factory(context));
    this.api = Object.assign(this.api, ...allApis);
  }

  public on<K extends keyof E>(
    event: K,
    listener: (payload: E[K]) => void
  ): void {
    (this.listeners[event] = this.listeners[event] || []).push(listener);
  }

  public off<K extends keyof E>(
    event: K,
    listener: (payload: E[K]) => void
  ): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event]!.filter(l => l !== listener);
  }

  public emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.listeners[event]?.forEach(l => l(payload));
  }
}

/**
 * Creates a new NodeFlow instance with the given plugins.
 * The instance's type is inferred from the plugins provided.
 */
export function createNodeFlow<const P extends readonly NodeFlowPlugin[]>(
  plugins: P
): NodeFlowInstance<P> {
  type InstanceState = CoreState & PluginsState<P>;
  type InstanceApi = CoreApi & PluginsApi<P>;
  type InstanceEvents = CoreEvents & PluginsEvents<P>;

  const coreState: CoreState = {
    nodes: {},
    edges: {}
  };

  const coreApiFactory = (
    context: PluginContext<InstanceState, InstanceApi, InstanceEvents>
  ): CoreApi => ({
    addNode: node => {
      context.setState({
        nodes: { ...context.getState().nodes, [node.id]: node }
      });
      context.emit("node:added", { nodeId: node.id });
    },
    addEdge: edge => {
      context.setState({
        edges: { ...context.getState().edges, [edge.id]: edge }
      });
      context.emit("edge:added", { edgeId: edge.id });
    }
  });

  const initialPluginState = plugins.reduce(
    (acc, plugin) => ({ ...acc, ...plugin.state }),
    {}
  );
  const initialState = { ...coreState, ...initialPluginState } as InstanceState;

  const apiFactories = [
    coreApiFactory,
    ...plugins.map(p => p.api).filter(Boolean)
  ] as ((context: any) => Partial<InstanceApi>)[];

  return new NodeFlow(initialState, apiFactories) as NodeFlowInstance<P>;
}
