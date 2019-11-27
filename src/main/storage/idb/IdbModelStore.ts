/*
 * Copyright (c) 2019 - Convergence Labs, Inc.
 *
 * This file is part of the Convergence JavaScript Client, which is released
 * under the terms of the GNU Lesser General Public License version 3
 * (LGPLv3), which is a refinement of the GNU Lesser General Public License
 * version 3 (GPLv3).  A copy of the both the GPLv3 and the LGPLv3 should have
 * been provided along with this file, typically located in the "COPYING" and
 * "COPYING.LESSER" files (respectively), which are part of this source code
 * package. Alternatively, see <https://www.gnu.org/licenses/gpl-3.0.html> and
 * <https://www.gnu.org/licenses/lgpl-3.0.html> for the full text of the GPLv3
 * and LGPLv3 licenses, if they were not provided.
 */

import {IdbPersistenceStore} from "./IdbPersistenceStore";
import {
  ILocalOperationData,
  IModelCreationData,
  IModelData,
  IModelMetaData,
  IModelSnapshot,
  IModelState,
  IModelStore,
  IModelUpdate,
  IServerOperationData
} from "../api";
import {toPromise, toVoidPromise} from "./promise";
import {IdbSchema} from "./IdbSchema";
import {ModelPermissions} from "../../model";
import {IModelMetaDataDocument} from "../api/IModelMetaDataDocument";

/**
 * @hidden
 * @internal
 */
export class IdbModelStore extends IdbPersistenceStore implements IModelStore {
  private static _deleteServerOperationsForModel(store: IDBObjectStore, modelId: string): Promise<void> {
    return IdbPersistenceStore.deleteFromIndex(store,
      IdbSchema.ModelServerOperation.Indices.ModelId,
      IDBKeyRange.only(modelId));
  }

  private static _deleteLocalOperationsForModel(store: IDBObjectStore, modelId: string): Promise<void> {
    return IdbPersistenceStore.deleteFromIndex(store,
      IdbSchema.ModelLocalOperation.Indices.ModelId,
      IDBKeyRange.only(modelId));
  }

  private static async _putLocalOperationsForModel(store: IDBObjectStore,
                                                   operations: ILocalOperationData[]): Promise<void> {
    for (const op of operations) {
      await toVoidPromise(store.add(op));
    }
  }

  private static async _putServerOperationsForModel(store: IDBObjectStore,
                                                    operations: IServerOperationData[]): Promise<void> {
    for (const op of operations) {
      await toVoidPromise(store.add(op));
    }
  }

  private static _snapshotToDataAndMetaData(version: number, snapshot: IModelSnapshot):
    { data: IModelData, meta: IModelMetaDataDocument } {
    const data: IModelData = {
      modelId: snapshot.modelId,
      data: snapshot.data
    };

    const meta: IModelMetaDataDocument = {
      modelId: snapshot.modelId,

      available: 1,

      details: {
        collection: snapshot.collection,
        createdTime: snapshot.createdTime,
        modifiedTime: snapshot.modifiedTime,
        permissions: {
          read: snapshot.permissions.read,
          write: snapshot.permissions.write,
          remove: snapshot.permissions.remove,
          manage: snapshot.permissions.manage,
        },
        seqNo: snapshot.seqNo,
        version,
        dataVersion: snapshot.dataVersion
      }
    };

    if (snapshot.local) {
      meta.created = 1;
    }

    if (snapshot.dirty) {
      meta.dirty = 1;
    }

    if (snapshot.subscribed) {
      meta.subscribed = 1;
    }

    return {data, meta};
  }

  private static _metaDataDocToMetaData(doc: IModelMetaDataDocument): IModelMetaData {
    const metaData: IModelMetaData = {
      modelId: doc.modelId,

      subscribed: doc.subscribed === 1,
      available: doc.available === 1,
      deleted: doc.deleted === 1,
      created: doc.created === 1,
      dirty: doc.dirty === 1
    };

    if (doc.details) {
      metaData.details = {
        collection: doc.details.collection,
        version: doc.details.version,
        dataVersion: doc.details.dataVersion,
        seqNo: doc.details.seqNo,
        createdTime: doc.details.createdTime,
        modifiedTime: doc.details.modifiedTime,
        permissions: new ModelPermissions(
          doc.details.permissions.read,
          doc.details.permissions.write,
          doc.details.permissions.remove,
          doc.details.permissions.manage,
        )
      };
    }

    return metaData;
  }

  private static async _putModelState(
    modelState: IModelState,
    modelMetaDataStore: IDBObjectStore,
    modelDataStore: IDBObjectStore,
    localOpStore: IDBObjectStore,
    serverOpStore: IDBObjectStore): Promise<void> {
    const {version, snapshot, localOperations, serverOperations} = modelState;

    const {data, meta} = IdbModelStore._snapshotToDataAndMetaData(version, snapshot);
    modelDataStore.put(data);
    modelMetaDataStore.put(meta);

    await IdbModelStore._deleteServerOperationsForModel(serverOpStore, meta.modelId);
    await IdbModelStore._deleteLocalOperationsForModel(localOpStore, meta.modelId);
    await IdbModelStore._putLocalOperationsForModel(localOpStore, localOperations);
    await IdbModelStore._putServerOperationsForModel(serverOpStore, serverOperations);
  }

  private static async _removeSubscriptions(
    modelIds: string[],
    createStore: IDBObjectStore,
    modelMetaDataStore: IDBObjectStore,
    modelDataStore: IDBObjectStore,
    localOpStore: IDBObjectStore,
    serverOpStore: IDBObjectStore): Promise<void> {

    for (const modelId of modelIds) {
      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(modelId));
      delete metaData.subscribed;

      // If we don't have changes to go up to the server we can remove.
      if (!metaData.created && !metaData.dirty) {
        await this._deleteModel(modelId, createStore, modelMetaDataStore, modelDataStore, localOpStore, serverOpStore);
      } else {
        await modelMetaDataStore.put(metaData);
      }
    }
  }

  private static async _deleteModel(
    modelId: string,
    modelCreateStore: IDBObjectStore,
    modelMetaDataStore: IDBObjectStore,
    modelDataStore: IDBObjectStore,
    localOpStore: IDBObjectStore,
    serverOpStore: IDBObjectStore): Promise<void> {

    await modelCreateStore.delete(modelId);
    await modelMetaDataStore.delete(modelId);
    await modelDataStore.delete(modelId);
    await IdbModelStore._deleteServerOperationsForModel(serverOpStore, modelId);
    await IdbModelStore._deleteLocalOperationsForModel(localOpStore, modelId);
  }

  private static async _addSubscriptions(modelIds: string[], metaDataStore: IDBObjectStore): Promise<void> {
    for (const modelId of modelIds) {
      const current = await toPromise<IModelMetaDataDocument>(metaDataStore.get(modelId));
      let updated: IModelMetaDataDocument;
      if (current !== undefined) {
        updated = current;
        updated.subscribed = 1;
      } else {
        updated = {
          modelId,
          subscribed: 1,
        };
      }

      await toVoidPromise(metaDataStore.put(updated));
    }
  }

  public createLocalModel(modelCreation: IModelCreationData): Promise<void> {
    const stores = [
      IdbSchema.ModelCreation.Store,
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store
    ];

    return this._withWriteStores(stores, async ([
                                                  creationStore,
                                                  modelMetaDataStore,
                                                  modelDataStore,
                                                  localOpStore,
                                                  serverOpStore]) => {
      await toVoidPromise(creationStore.put(modelCreation));

      const dataVersion = 1;
      const version = dataVersion;
      const seqNo = 0;
      const now = new Date();
      const permissions = new ModelPermissions(true, true, true, true);
      const modelState: IModelState = {
        version,
        snapshot: {
          modelId: modelCreation.modelId,
          local: true,
          dirty: true,
          subscribed: false,
          collection: modelCreation.collection,
          dataVersion,
          seqNo,
          createdTime: now,
          modifiedTime: now,
          permissions,
          data: modelCreation.initialData
        },
        localOperations: [],
        serverOperations: []
      };

      await IdbModelStore._putModelState(modelState, modelMetaDataStore, modelDataStore, localOpStore, serverOpStore);
    });
  }

  public markModelForDeletion(modelId: string): Promise<void> {
    const stores = [
      IdbSchema.ModelCreation.Store,
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store
    ];

    return this._withWriteStores(stores, async ([
                                                  creationStore,
                                                  modelMetaDataStore,
                                                  modelDataStore,
                                                  localOpStore,
                                                  serverOpStore]) => {
      await toVoidPromise(creationStore.delete(modelId));
      await IdbModelStore._deleteLocalOperationsForModel(localOpStore, modelId);
      await IdbModelStore._deleteServerOperationsForModel(serverOpStore, modelId);
      await toVoidPromise(modelDataStore.delete(modelId));
      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(modelId));
      delete metaData.details;
      delete metaData.subscribed;
      delete metaData.dirty;
      delete metaData.available;
      metaData.deleted = 1;

      await toVoidPromise(modelMetaDataStore.put(metaData));
    });
  }

  public modelDeleted(modelId: string): Promise<void> {
    const stores = [
      IdbSchema.ModelCreation.Store,
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store
    ];

    return this._withWriteStores(stores, async ([
                                                  creationStore,
                                                  modelMetaDataStore,
                                                  modelDataStore,
                                                  localOpStore,
                                                  serverOpStore]) => {
      await IdbModelStore._deleteModel(
        modelId, creationStore, modelMetaDataStore, modelDataStore, localOpStore, serverOpStore);
    });
  }

  public getDeletedModelIds(): Promise<string[]> {
    return this._withReadStore(IdbSchema.ModelMetaData.Store, (store) => {
      const idx = store.index(IdbSchema.ModelMetaData.Indices.Deleted);
      return toPromise(idx.getAllKeys()) as Promise<string[]>;
    });
  }

  public modelCreated(modelId: string): Promise<void> {
    const stores = [
      IdbSchema.ModelCreation.Store,
      IdbSchema.ModelMetaData.Store
    ];

    return this._withWriteStores(stores, async ([creationStore, modelMetaDataStore]) => {
      creationStore.delete(modelId);
      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(modelId));
      metaData.available = 1;
      delete metaData.created;
      delete metaData.dirty;
      return toVoidPromise(modelMetaDataStore.put(metaData));
    });
  }

  public deleteIfNotNeeded(modelId: string): Promise<void> {
    return this._withReadStore(IdbSchema.ModelMetaData.Store, async (modelMetaDataStore) => {
      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(modelId));
      return metaData !== undefined && !metaData.created && !metaData.dirty && !metaData.subscribed;
    }).then(remove => {
      if (remove) {
        const storeNames = [
          IdbSchema.ModelCreation.Store,
          IdbSchema.ModelMetaData.Store,
          IdbSchema.ModelData.Store,
          IdbSchema.ModelLocalOperation.Store,
          IdbSchema.ModelServerOperation.Store
        ];
        return this._withWriteStores(
          storeNames,
          async ([createStore, metaDataStore, dataStore, localOpStore, serverOpStore]) => {
            await IdbModelStore._deleteModel(
              modelId, createStore, metaDataStore, dataStore, localOpStore, serverOpStore);
          });
      } else {
        return;
      }
    });
  }

  public getModelCreationData(modelId: string): Promise<IModelCreationData> {
    return this._withReadStore(IdbSchema.ModelCreation.Store, async store => {
      return toPromise(store.get(modelId));
    });
  }

  public putModelState(modelState: IModelState): Promise<void> {
    const stores = [
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store
    ];
    return this._withWriteStores(stores, async ([modelMetaData, modelDataStore, localOpStore, serverOpStore]) => {
      IdbModelStore._putModelState(modelState, modelMetaData, modelDataStore, localOpStore, serverOpStore);
    });
  }

  public updateOfflineModel(update: IModelUpdate): Promise<void> {
    const stores = [
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store
    ];

    return this._withWriteStores(stores, async ([modelMetaDataStore, modelDataStore]) => {
      const {modelId, dataUpdate, permissionsUpdate} = update;
      const modelMetaData: IModelMetaData = await toPromise(modelMetaDataStore.get(modelId));

      if (modelMetaData === undefined) {
        throw Error("Received an update for a non-existent local model");
      }

      // TODO we should check to see if the model is locally modified.

      if (dataUpdate) {
        modelMetaData.details.version = dataUpdate.version;
        modelMetaData.details.dataVersion = dataUpdate.version;
        modelMetaData.details.createdTime = dataUpdate.createdTime;
        modelMetaData.details.modifiedTime = dataUpdate.modifiedTime;

        const data: IModelData = {
          modelId,
          data: dataUpdate.data
        };
        await toVoidPromise(modelDataStore.put(data));
      }

      if (permissionsUpdate) {
        modelMetaData.details.permissions = permissionsUpdate;
      }

      return toVoidPromise(modelMetaDataStore.put(modelMetaData));
    });
  }

  public modelExists(modelId: string): Promise<boolean> {
    if (modelId === undefined || modelId === null) {
      throw new Error("modelId must be defined");
    }

    return this._withReadStore(IdbSchema.ModelMetaData.Store, (store) => {
      const idx = store.index(IdbSchema.ModelMetaData.Indices.ModelId);
      return toPromise(idx.count(modelId)).then((count => count > 0));
    });
  }

  public getDirtyModelIds(): Promise<string[]> {
    return this._withReadStore(IdbSchema.ModelMetaData.Store, (store) => {
      const idx = store.index(IdbSchema.ModelMetaData.Indices.Dirty);
      return toPromise(idx.getAllKeys()) as Promise<string[]>;
    });
  }

  public processServerOperation(serverOp: IServerOperationData): Promise<void> {
    const stores = [
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelServerOperation.Store
    ];

    return this._withWriteStores(stores, async ([modelMetaDataStore, serverOpStore]) => {
      await toVoidPromise(serverOpStore.add(serverOp));
      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(serverOp.modelId));
      metaData.details.version = serverOp.version + 1;
      metaData.details.modifiedTime = serverOp.timestamp;

      await toVoidPromise(modelMetaDataStore.put(metaData));
    });
  }

  public processLocalOperation(localOp: ILocalOperationData): Promise<void> {
    const stores = [
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelLocalOperation.Store
    ];

    return this._withWriteStores(stores, async ([modelMetaDataStore, localOpStore]) => {
      await toVoidPromise(localOpStore.add(localOp));
      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(localOp.modelId));
      metaData.dirty = 1;
      metaData.details.seqNo = localOp.sequenceNumber;
      await toVoidPromise(modelMetaDataStore.put(metaData));
    });
  }

  public processOperationAck(modelId: string,
                             seqNo: number,
                             serverOp: IServerOperationData): Promise<void> {
    const stores = [
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store,
      IdbSchema.ModelMetaData.Store
    ];

    return this._withWriteStores(stores, async ([localOpStore, serverOpStore, modelMetaDataStore]) => {
      await toVoidPromise(localOpStore.delete([modelId, seqNo]));
      await toVoidPromise(serverOpStore.add(serverOp));

      const metaData = await toPromise<IModelMetaDataDocument>(modelMetaDataStore.get(modelId));

      metaData.details.version = serverOp.version + 1;
      metaData.details.modifiedTime = serverOp.timestamp;

      const idx = localOpStore.index(IdbSchema.ModelLocalOperation.Indices.ModelId);
      const dirty = await toPromise(idx.count(modelId)).then((count => count > 0));
      if (dirty) {
        metaData.dirty = 1;
      } else {
        delete metaData.dirty;
      }

      await toVoidPromise(modelMetaDataStore.put(metaData));
    });
  }

  public getModelState(modelId: string): Promise<IModelState | undefined> {
    if (modelId === undefined || modelId === null) {
      throw new Error("modelId must be defined");
    }

    const stores = [
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store
    ];
    return this._withReadStores(stores,
      async ([modelMetaDataStore, modelDataStore, localOpStore, serverOpStore]) => {
        const meta: IModelMetaDataDocument = await toPromise(modelMetaDataStore.get(modelId));
        const data: IModelData = await toPromise(modelDataStore.get(modelId));
        if (meta && data) {
          const localOpsIndex = localOpStore.index(IdbSchema.ModelLocalOperation.Indices.ModelId);
          const localOperations = await toPromise(localOpsIndex.getAll(modelId));

          const serverOpsIndex = serverOpStore.index(IdbSchema.ModelServerOperation.Indices.ModelId);
          const serverOperations = await toPromise(serverOpsIndex.getAll(modelId));
          const snapshot: IModelSnapshot = {
            modelId: meta.modelId,
            collection: meta.details.collection,
            local: meta.created === 1,
            dirty: meta.dirty === 1,
            subscribed: meta.subscribed === 1,
            dataVersion: meta.details.dataVersion,
            seqNo: meta.details.seqNo,
            createdTime: meta.details.createdTime,
            modifiedTime: meta.details.modifiedTime,
            permissions: new ModelPermissions(
              meta.details.permissions.read,
              meta.details.permissions.write,
              meta.details.permissions.remove,
              meta.details.permissions.manage,
            ),
            data: data.data
          };

          const version = meta.details.version;

          return {version, snapshot, localOperations, serverOperations} as IModelState;
        } else {
          return;
        }
      });
  }

  public getAllModelMetaData(): Promise<IModelMetaData[]> {
    return this._getAll(IdbSchema.ModelMetaData.Store)
      .then(results => results.map(IdbModelStore._metaDataDocToMetaData));
  }

  public setModelSubscriptions(modelIds: string[]): Promise<void> {
    const storeNames = [
      IdbSchema.ModelCreation.Store,
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store
    ];
    return this._withWriteStores(
      storeNames,
      async ([createStore, metaDataStore, dataStore, localOpStore, serverOpStore]) => {
        const index = metaDataStore.index(IdbSchema.ModelMetaData.Indices.Subscribed);
        const subscribed = await toPromise<IModelMetaDataDocument[]>(index.getAll());
        const subscribedModelIds = subscribed.map(s => s.modelId);
        const toAdd = modelIds.filter(id => !subscribedModelIds.includes(id));
        const toRemove = subscribedModelIds.filter(id => !modelIds.includes(id));

        await IdbModelStore._removeSubscriptions(
          toRemove, createStore, metaDataStore, dataStore, localOpStore, serverOpStore);
        await IdbModelStore._addSubscriptions(toAdd, metaDataStore);
      });
  }

  public getSubscribedModels(): Promise<IModelMetaData[]> {
    const storeName = IdbSchema.ModelMetaData.Store;
    return this._withReadStore(storeName, async (store) => {
      const index = store.index(IdbSchema.ModelMetaData.Indices.Subscribed);
      const subscribed = await toPromise<IModelMetaDataDocument[]>(index.getAll());
      return subscribed.map(IdbModelStore._metaDataDocToMetaData);
    });
  }

  public addSubscriptions(modelIds: string[]): Promise<void> {
    const storeName = IdbSchema.ModelMetaData.Store;
    return this._withWriteStore(storeName, (store) => IdbModelStore._addSubscriptions(modelIds, store));
  }

  public removeSubscriptions(modelIds: string[]): Promise<void> {
    const stores = [
      IdbSchema.ModelCreation.Store,
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelLocalOperation.Store,
      IdbSchema.ModelServerOperation.Store,
    ];

    return this._withWriteStores(stores,
      async ([createStore, modelMetaDataStore, modelDataStore, localOpStore, serverOpStore]) => {
        return IdbModelStore._removeSubscriptions(
          modelIds,
          createStore,
          modelMetaDataStore,
          modelDataStore,
          localOpStore,
          serverOpStore);
      });
  }

  public snapshotModel(snapshot: IModelSnapshot): Promise<void> {
    const stores = [
      IdbSchema.ModelMetaData.Store,
      IdbSchema.ModelData.Store,
      IdbSchema.ModelServerOperation.Store
    ];
    return this._withWriteStores(stores,
      async ([modelMetaDataStore, modelDataStore, serverOpStore]) => {
        const {data, meta} = IdbModelStore._snapshotToDataAndMetaData(snapshot.dataVersion, snapshot);
        modelMetaDataStore.put(meta);
        modelDataStore.put(data);
        IdbModelStore._deleteServerOperationsForModel(serverOpStore, meta.modelId);
      });
  }
}
