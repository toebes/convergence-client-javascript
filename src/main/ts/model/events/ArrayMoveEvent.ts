module convergence.model.event {

  export class ArrayMoveEvent extends ModelChangeEvent {
    /**
     * Constructs a new ArrayMoveEvent.
     */
    constructor(sessionId: string,
                username: string,
                version: number,
                timestamp: number,
                target: RealTimeArray,
                public fromIndex: number,
                public toIndex: number) {
      super(sessionId, username, version, timestamp, target);
      // TODO: Freeze???
    }
  }
}
