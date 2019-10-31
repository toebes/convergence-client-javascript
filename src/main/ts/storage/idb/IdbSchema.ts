/**
 * @hidden
 * @internal
 */
export const IdbSchema = {
  ModelSubscriptions: {
    Store: "ModelSubscription",
    Indices: {
      ModelId: "ModelSubscription.modelId"
    },
    Fields: {
      ModelId: "modelId"
    }
  },
  ModelCreation: {
    Store: "ModelCreation",
    Fields: {
      ModelId: "modelId"
    },
    Indices: {
      ModelId: "ModelCreation.modelId"
    }
  },
  ModelData: {
    Store: "ModelData",
    Fields: {
      ModelId: "modelId"
    },
    Indices: {
      ModelId: "ModelData.modelId"
    }
  },
  ModelServerOperation: {
    Store: "ModelServerOperation",
    Fields: {
      ModelId: "modelId",
      SessionId: "sessionId",
      Version: "version"
    },
    Indices: {
      ModelId: "ModelServerOperation.modelId",
      ModelId_Version: "ModelServerOperation.modelId_version"
    }
  },
  ModelLocalOperation: {
    Store: "ModelLocalOperation",
    Fields: {
      ModelId: "modelId",
      SessionId: "sessionId",
      SequenceNumber: "sequenceNumber"
    },
    Indices: {
      ModelId: "ModelLocalOperation.modelId",
      ModelId_SessionId_SequenceNumber: "ModelLocalOperation.modelId_sessionId_sequenceNumber"
    },
  }
};
