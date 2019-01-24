import {AppliedDiscreteOperation} from "./AppliedDiscreteOperation";
import {BooleanSet} from "../ops/operationChanges";
import {OperationType} from "../ops/OperationType";

/**
 * @hidden
 * @internal
 */
export class AppliedBooleanSetOperation extends AppliedDiscreteOperation implements BooleanSet {

  constructor(id: string,
              noOp: boolean,
              public readonly value: boolean,
              public readonly oldValue: boolean) {
    super(OperationType.BOOLEAN_VALUE, id, noOp);
    Object.freeze(this);
  }

  public inverse(): AppliedBooleanSetOperation {
    return new AppliedBooleanSetOperation(this.id, this.noOp, this.oldValue, this.value);
  }
}
