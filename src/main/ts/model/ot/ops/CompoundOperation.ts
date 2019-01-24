import {Operation} from "./Operation";
import {DiscreteOperation} from "./DiscreteOperation";
import {Immutable} from "../../../util/Immutable";
import {OperationType} from "./OperationType";
import {BatchChange} from "./operationChanges";

/**
 * @hidden
 * @internal
 */
export class CompoundOperation extends Operation implements BatchChange {
  constructor(public readonly ops: DiscreteOperation[]) {
    super(OperationType.COMPOUND);
    Object.freeze(this);
  }

  public copy(updates: any): CompoundOperation {
    return new CompoundOperation(Immutable.update(this.ops, updates.ops));
  }
}
