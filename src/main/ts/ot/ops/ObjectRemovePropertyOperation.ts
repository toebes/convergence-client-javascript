import Immutable from "../../util/Immutable";
import DiscreteOperation from "./DiscreteOperation";
import {Path} from "../Path";

export default class ObjectRemovePropertyOperation extends DiscreteOperation {

  static TYPE: string = "ObjectRemoveProperty";

  protected _prop: string;

  constructor(path: Path, noOp: boolean, public prop: string) {
    super(ObjectRemovePropertyOperation.TYPE, path, noOp);
    Object.freeze(this);
  }

  copy(updates: any): ObjectRemovePropertyOperation {
    return new ObjectRemovePropertyOperation(
      Immutable.update(this.path, updates.path),
      Immutable.update(this.noOp, updates.noOp),
      Immutable.update(this.prop, updates.prop));
  }
}

