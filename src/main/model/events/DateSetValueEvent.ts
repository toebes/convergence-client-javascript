/*
 * Copyright (c) 2019 - Convergence Labs, Inc.
 *
 * This file is subject to the terms and conditions defined in the files
 * 'LICENSE' and 'COPYING.LESSER', which are part of this source code package.
 */

import {IValueChangedEvent} from "./IValueChangedEvent";
import {ObservableDate} from "../observable/ObservableDate";
import {DomainUser} from "../../identity";

/**
 * Emitted when the [[RealTimeDate.value]] of a [[RealTimeDate]] is set.
 *
 * @module Real Time Data
 */
export class DateSetValueEvent implements IValueChangedEvent {
  public static readonly NAME = "value";

  /**
   * @inheritdoc
   */
  public readonly name: string = DateSetValueEvent.NAME;

  /**
   * @param element
   * @param sessionId
   * @param user
   * @param local
   *
   * @hidden
   * @internal
   */
  constructor(
    /**
     * The [[RealTimeDate]] or [[HistoricalDate]] which was modified
     */
    public readonly element: ObservableDate,

    /**
     * @inheritdoc
     */
    public readonly user: DomainUser,

    /**
     * @inheritdoc
     */
    public readonly sessionId: string,

    /**
     * True if the change occurred locally (within the current session)
     */
    public readonly local: boolean
  ) {
    Object.freeze(this);
  }
}