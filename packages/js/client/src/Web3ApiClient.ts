import { getDefaultRedirects } from "./default-redirects";
import { PluginWeb3Api } from "./plugin/PluginWeb3Api";
import { WasmWeb3Api } from "./wasm/WasmWeb3Api";

import {
  Api,
  ApiCache,
  Client,
  createQueryDocument,
  parseQuery,
  PluginPackage,
  QueryApiOptions,
  QueryApiResult,
  Uri,
  UriRedirect,
  resolveUri,
  InvokeApiOptions,
  InvokeApiResult,
  Manifest,
  sanitizeUriRedirects,
} from "@web3api/core-js";
import Web3APITracer from "@web3api/logger";

export interface ClientConfig<TUri = string> {
  redirects: UriRedirect<TUri>[];
}

export class Web3ApiClient implements Client {
  // TODO: the API cache needs to be more like a routing table.
  // It should help us keep track of what URI's map to what APIs,
  // and handle cases where the are multiple jumps. For exmaple, if
  // A => B => C, then the cache should have A => C, and B => C.
  private _apiCache: ApiCache = new Map<string, Api>();
  private _config: ClientConfig<Uri>;

  private _tracer: Web3APITracer;

  constructor(config: ClientConfig, private _logEnabled: boolean = false) {
    this._config = {
      ...config,
      redirects: sanitizeUriRedirects(config.redirects),
    };

    // Add all default redirects (IPFS, ETH, ENS)
    this._config.redirects.push(...getDefaultRedirects());

    this._tracer = new Web3APITracer(this._logEnabled, "web3api-client");

    this._tracer.startSpan("constructor");

    this._tracer.setAttribute("config", this._config);
    this._tracer.addEvent("created");

    this._tracer.endSpan();
  }

  public redirects(): readonly UriRedirect<Uri>[] {
    return this._config.redirects;
  }

  public async query<
    TData extends Record<string, unknown> = Record<string, unknown>,
    TVariables extends Record<string, unknown> = Record<string, unknown>
  >(
    options: QueryApiOptions<TVariables, string>
  ): Promise<QueryApiResult<TData>> {
    try {
      const { uri, query, variables } = options;

      this._tracer.startSpan("query");

      this._tracer.setAttribute("options", options);

      // Convert the query string into a query document
      const queryDocument =
        typeof query === "string" ? createQueryDocument(query) : query;

      // Parse the query to understand what's being invoked
      const invokeOptions = parseQuery(new Uri(uri), queryDocument, variables);

      // Execute all invocations in parallel
      const parallelInvocations: Promise<{
        method: string;
        result: InvokeApiResult<unknown>;
      }>[] = [];

      for (const invocation of invokeOptions) {
        parallelInvocations.push(
          this.invoke({
            ...invocation,
            uri: invocation.uri.uri,
            decode: true,
          }).then((result) => ({
            method: invocation.method,
            result,
          }))
        );
      }

      // Await the invocations
      const invocations = await Promise.all(parallelInvocations);

      this._tracer.addEvent("invocations finished", invocations);

      // Aggregate all invocation results
      let methods: string[] = [];
      const resultDatas: unknown[] = [];
      const errors: Error[] = [];

      for (const invocation of invocations) {
        methods.push(invocation.method);
        resultDatas.push(invocation.result.data);
        if (invocation.result.error) {
          errors.push(invocation.result.error);
        }
      }

      // Helper for appending "_#" to repeated names
      const makeRepeatedUnique = (names: string[]): string[] => {
        const counts: { [key: string]: number } = {};

        return names.reduce((acc, name) => {
          const count = (counts[name] = (counts[name] || 0) + 1);
          const uniq = count > 1 ? `${name}_${count - 1}` : name;
          acc.push(uniq);
          return acc;
        }, [] as string[]);
      };

      methods = makeRepeatedUnique(methods);

      // Build are data map, where each method maps to its data
      const data: Record<string, unknown> = {};

      for (let i = 0; i < methods.length; ++i) {
        data[methods[i]] = resultDatas[i];
      }

      this._tracer.setAttribute("methods", methods);
      this._tracer.setAttribute("data", data);

      return {
        data: data as TData,
        errors: errors.length === 0 ? undefined : errors,
      };
    } catch (error) {
      this._tracer.recordException(error);

      if (error.length) {
        return { errors: error };
      } else {
        return { errors: [error] };
      }
    } finally {
      this._tracer.endSpan();
    }
  }

  public async invoke<TData = unknown>(
    options: InvokeApiOptions<string>
  ): Promise<InvokeApiResult<TData>> {
    try {
      const uri = new Uri(options.uri);

      this._tracer.startSpan("invoke");

      this._tracer.setAttribute("options", options);

      const api = await this.loadWeb3Api(uri);

      this._tracer.addEvent("load-web3api", api);

      return (await api.invoke(
        {
          ...options,
          uri,
        },
        this
      )) as TData;
    } catch (error) {
      this._tracer.recordException(error);

      return { error: error };
    } finally {
      this._tracer.endSpan();
    }
  }

  public async loadWeb3Api(uri: Uri): Promise<Api> {
    let api = this._apiCache.get(uri.uri);

    this._tracer.startSpan("load-web3api");

    this._tracer.setAttribute("uri", uri);

    if (!api) {
      api = await resolveUri(
        uri,
        this,
        (uri: Uri, plugin: PluginPackage) => new PluginWeb3Api(uri, plugin),
        (uri: Uri, manifest: Manifest, apiResolver: Uri) =>
          new WasmWeb3Api(uri, manifest, apiResolver)
      );

      this._tracer.addEvent("resolve-uri", api);

      if (!api) {
        throw Error(`Unable to resolve Web3API at uri: ${uri}`);
      }

      this._apiCache.set(uri.uri, api);
    }

    this._tracer.endSpan();

    return api;
  }
}
