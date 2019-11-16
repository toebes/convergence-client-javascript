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

/**
 * @hidden
 * @internal
 */
export class Deferred<R> {

  private readonly _promise: Promise<R>;
  private _resolve: (value?: R | PromiseLike<R>) => any;
  private _reject: (error: Error) => void;

  private _rejected: boolean;
  private _resolved: boolean;

  constructor() {
    this._promise = new Promise((resolve: (value?: R | PromiseLike<R>) => any, reject: (error: Error) => void) => {
      this._resolve = resolve;
      this._reject = reject;
    });

    this._rejected = false;
    this._resolved = false;
  }

  public isPending(): boolean {
    return this._resolved || this._rejected;
  }

  public isRejected(): boolean {
    return this._rejected;
  }

  public isResolved(): boolean {
    return this._resolved;
  }

  public resolve(value?: R | PromiseLike<R>): void {
    this._rejected = false;
    this._resolved = true;
    this._resolve(value);
  }

  public reject(error: Error): void {
    this._rejected = true;
    this._resolved = false;
    this._reject(error);
  }

  public resolveFromPromise(p: Promise<R>): void {
    p.then((r: R) => this.resolve(r)).catch((e: Error) => this.reject(e));
  }

  public promise(): Promise<R> {
    return this._promise;
  }
}
