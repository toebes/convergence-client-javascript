import {IModelState} from "./IModelState";
import {ILocalOperationData, IServerOperationData} from "./IModelOperationData";

export interface IModelStore {
  getSubscribedModels(): Promise<string[]>;

  subscribeToModel(modelId: string): Promise<void>;

  setModelSubscriptions(modelIds: string[]): Promise<void>;

  unsubscribeToModel(modelId: string): Promise<void>;

  putModel(model: IModelState): Promise<void>;

  getModel(modelId: string): Promise<IModelState>;

  modelExists(modelId: string): Promise<boolean>;

  processServerOperation(serverOp: IServerOperationData): Promise<void>;

  processLocalOperation(localOp: ILocalOperationData): Promise<void>;

  processOperationAck(modelId: string, seqNo: number, serverOp: IServerOperationData): Promise<void>;
}
