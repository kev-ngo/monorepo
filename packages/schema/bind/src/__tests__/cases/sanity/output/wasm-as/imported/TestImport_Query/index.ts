import {
  w3_subquery,
  Nullable
} from "@web3api/wasm-as";
import {
  serializeimportedMethodArgs,
  deserializeimportedMethodResult,
  serializeanotherMethodArgs,
  deserializeanotherMethodResult
} from "./serialization";

export class TestImport_Query {

  public static uri: string = "testimport.uri.eth";

  public static importedMethod(input: {
    str: string,
    optStr: string | null,
    u: u32,
    optU: Nullable<u32>,
    uArrayArray: Array<Array<Nullable<u32>> | null>
  }): string {
    const args = serializeimportedMethodArgs(input);
    const result = w3_subquery(
      uri,
      `query {
        importedMethod(
          str: $str,
          optStr: $optStr,
          u: $u,
          optU: $optU,
          uArrayArray: $uArrayArray
        )
      }`,
      args
    );
    return deserializeimportedMethodResult(result);
  }

  public static anotherMethod(input: {
    arg: Array<string>
  }): i64 {
    const args = serializeanotherMethodArgs(input);
    const result = w3_subquery(
      uri,
      `query {
        anotherMethod(
          arg: $arg
        )
      }`,
      args
    );
    return deserializeanotherMethodResult(result);
  }
}
