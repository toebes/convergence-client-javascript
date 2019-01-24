import {RealTimeElement} from "./RealTimeElement";
import {StringNode} from "../internal/StringNode";
import {RealTimeModel, ModelEventCallbacks} from "./RealTimeModel";
import {
  LocalModelReference,
  ModelReference,
  IndexReference,
  LocalRangeReference,
  RangeReference
} from "../reference/";
import {StringInsertOperation} from "../ot/ops/StringInsertOperation";
import {StringRemoveOperation} from "../ot/ops/StringRemoveOperation";
import {LocalIndexReference} from "../reference/LocalIndexReference";
import {StringSetOperation} from "../ot/ops/StringSetOperation";
import {
  StringNodeInsertEvent,
  StringNodeRemoveEvent,
  StringNodeSetValueEvent,
  ModelNodeEvent
} from "../internal/events";
import {RealTimeWrapperFactory} from "./RealTimeWrapperFactory";
import {
  ObservableString,
  ObservableStringEvents,
  ObservableStringEventConstants
} from "../observable/ObservableString";
import {IdentityCache} from "../../identity/IdentityCache";

export interface RealTimeStringEvents extends ObservableStringEvents {
}

export class RealTimeString extends RealTimeElement<string> implements ObservableString {

  public static readonly Events: RealTimeStringEvents = ObservableStringEventConstants;

  /**
   * Constructs a new RealTimeString.
   *
   * @hidden
   * @internal
   */
  constructor(delegate: StringNode,
              callbacks: ModelEventCallbacks,
              wrapperFactory: RealTimeWrapperFactory,
              model: RealTimeModel,
              identityCache: IdentityCache) {
    super(delegate, callbacks, wrapperFactory, model,
      [ModelReference.Types.INDEX, ModelReference.Types.RANGE], identityCache);

    (this._delegate as StringNode).events().subscribe(e => this._handleReferenceModelEvents(e));
  }

  public insert(index: number, value: string): void {
    this._assertWritable();
    (this._delegate as StringNode).insert(index, value);
  }

  public remove(index: number, length: number): void {
    this._assertWritable();
    ((this._delegate as StringNode) as StringNode).remove(index, length);
  }

  public length(): number {
    return (this._delegate as StringNode).length();
  }

  /////////////////////////////////////////////////////////////////////////////
  // References
  /////////////////////////////////////////////////////////////////////////////

  // fixme the index and range reference methods are almost the same.  can we refactor?
  public indexReference(key: string): LocalIndexReference {
    const existing: LocalModelReference<any, any> = this._referenceManager.getLocalReference(key);
    if (existing !== undefined) {
      if (existing.reference().type() !== ModelReference.Types.INDEX) {
        throw new Error("A reference with this key already exists, but is not an index reference");
      } else {
        return existing as LocalIndexReference;
      }
    } else {
      const reference: IndexReference = new IndexReference(
        this._referenceManager, key, this,
        (this._delegate as StringNode).session().user(), (this._delegate as StringNode).session().sessionId(), true);
      const local: LocalIndexReference = new LocalIndexReference(
        reference,
        this._callbacks.referenceEventCallbacks
      );
      this._referenceManager.addLocalReference(local);
      return local;
    }
  }

  public rangeReference(key: string): LocalRangeReference {
    const existing: LocalModelReference<any, any> = this._referenceManager.getLocalReference(key);
    if (existing !== undefined) {
      if (existing.reference().type() !== ModelReference.Types.RANGE) {
        throw new Error("A reference with this key already exists, but is not a range reference");
      } else {
        return existing as LocalRangeReference;
      }
    } else {
      const reference: RangeReference = new RangeReference(
        this._referenceManager, key, this,
        (this._delegate as StringNode).session().user(), (this._delegate as StringNode).session().sessionId(), true);
      const local: LocalRangeReference = new LocalRangeReference(
        reference,
        this._callbacks.referenceEventCallbacks
      );
      this._referenceManager.addLocalReference(local);
      return local;
    }
  }

  /**
   * @private
   * @hidden
   * @internal
   */
  public _handleReferenceModelEvents(event: ModelNodeEvent): void {
    if (event instanceof StringNodeInsertEvent) {
      if (event.local) {
        this._sendOperation(new StringInsertOperation(this.id(), false, event.index, event.value));
      }
      this._referenceManager.getAll().forEach((ref: ModelReference<any>) => {
        if (ref instanceof IndexReference) {
          ref._handleInsert(event.index, event.value.length);
        } else if (ref instanceof RangeReference) {
          ref._handleInsert(event.index, event.value.length);
        }
      });
    } else if (event instanceof StringNodeRemoveEvent) {
      if (event.local) {
        this._sendOperation(new StringRemoveOperation(this.id(), false, event.index, event.value));
      }
      this._referenceManager.getAll().forEach((ref: ModelReference<any>) => {
        if (ref instanceof IndexReference) {
          ref._handleRemove(event.index, event.value.length);
        } else if (ref instanceof RangeReference) {
          ref._handleRemove(event.index, event.value.length);
        }
      });
    } else if (event instanceof StringNodeSetValueEvent) {
      if (event.local) {
        this._sendOperation(new StringSetOperation(this.id(), false, event.value));
      }
      this._referenceManager.getAll().forEach((ref: ModelReference<any>) => {
        ref._dispose();
      });
      this._referenceManager.removeAll();
    }
  }
}

Object.freeze(RealTimeString.Events);
