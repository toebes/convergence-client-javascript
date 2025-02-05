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

import {
  IProtocolConnectionErrorEvent,
  IProtocolConnectionMessageEvent,
  ProtocolConnection,
  ReplyCallback
} from "./ProtocolConnection";
import ConvergenceSocket from "./ConvergenceSocket";
import {ConvergenceSession} from "../ConvergenceSession";
import {ConvergenceDomain} from "../ConvergenceDomain";
import {Deferred} from "../util/Deferred";
import {ConvergenceError, ConvergenceEventEmitter, IConvergenceEvent} from "../util";
import {Observable} from "rxjs";
import {filter} from "rxjs/operators";
import {getOrDefaultObject, toOptional} from "./ProtocolUtil";
import {toDomainUser} from "../identity/IdentityMessageUtils";
import {ConvergenceOptions} from "../ConvergenceOptions";
import {IUsernameAndPassword} from "../IUsernameAndPassword";
import {ConvergenceErrorCodes} from "../util/ConvergenceErrorCodes";
import {TypeChecker} from "../util/TypeChecker";
import {FallbackAuthCoordinator} from "./FallbackAuthCoordinator";
import {Logging} from "../util/log/Logging";
import {Logger} from "../util/log/Logger";
import {AuthenticationMethod, AuthenticationMethods} from "./AuthenticationMethod";

import {com} from "@convergence/convergence-proto";
import {RandomStringGenerator} from "../util/RandomStringGenerator";
import IConvergenceMessage = com.convergencelabs.convergence.proto.IConvergenceMessage;
import IHandshakeResponseMessage = com.convergencelabs.convergence.proto.core.IHandshakeResponseMessage;
import IAuthenticationRequestMessage = com.convergencelabs.convergence.proto.core.IAuthenticationRequestMessage;
import IAuthenticationResponseMessage = com.convergencelabs.convergence.proto.core.IAuthenticationResponseMessage;
import IPasswordAuthRequestData =
  com.convergencelabs.convergence.proto.core.AuthenticationRequestMessage.IPasswordAuthRequestData;
import IJwtAuthRequestData =
  com.convergencelabs.convergence.proto.core.AuthenticationRequestMessage.IJwtAuthRequestData;
import IReconnectTokenAuthRequestData =
  com.convergencelabs.convergence.proto.core.AuthenticationRequestMessage.IReconnectTokenAuthRequestData;
import IAnonymousAuthRequestData =
  com.convergencelabs.convergence.proto.core.AuthenticationRequestMessage.IAnonymousAuthRequestData;

/**
 * @hidden
 * @internal
 */
export class ConvergenceConnection extends ConvergenceEventEmitter<IConnectionEvent> {

  public static Events: any = {
    MESSAGE: "message",

    CONNECTION_SCHEDULED: "connection_scheduled",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    CONNECTION_FAILED: "connection_failed",

    AUTHENTICATING: "authenticating",
    AUTHENTICATED: "authenticated",
    AUTHENTICATION_FAILED: "authentication_failed",

    INTERRUPTED: "interrupted",
    DISCONNECTED: "disconnected",
    ERROR: "error"
  };

  private static readonly _SessionIdGenerator = new RandomStringGenerator(32, RandomStringGenerator.AlphaNumeric);

  private readonly _options: ConvergenceOptions;
  private readonly _session: ConvergenceSession;
  private readonly _logger: Logger = Logging.logger("connection");
  private readonly _url: string;

  private _authenticated: boolean;
  private _connectionDeferred: Deferred<void>;
  private _connectionAttempts: number;
  private _connectionAttemptTask: any;
  private _connectionTimeoutTask: any;
  private _connectionState: ConnectionState;
  private _protocolConnection: ProtocolConnection;

  constructor(url: string, domain: ConvergenceDomain, options: ConvergenceOptions) {
    super();

    this._url = url.trim().toLowerCase();
    const urlExpression = /^(https?|wss?):\/{2}.+\/.+\/.+/g;

    if (!urlExpression.test(this._url)) {
      throw new Error(`Invalid domain connection url: ${this._url}`);
    }

    this._options = options;

    this._url = url;

    this._authenticated = false;

    this._connectionAttempts = 0;
    this._connectionState = ConnectionState.DISCONNECTED;
    this._connectionTimeoutTask = null;
    this._connectionAttemptTask = null;

    const initialSessionId = "offline:" + ConvergenceConnection._SessionIdGenerator.nextString();
    this._session = new ConvergenceSession(domain, this, null, initialSessionId, null);

    if (typeof window !== "undefined") {
      window.addEventListener("online", this._onWindowOnline);
    }
  }

  public url(): string {
    return this._url;
  }

  public session(): ConvergenceSession {
    return this._session;
  }

  public connect(): Promise<void> {
    if (this._connectionState !== ConnectionState.DISCONNECTED &&
      this._connectionState !== ConnectionState.INTERRUPTED) {
      throw new Error("Can only call connect on a disconnected or interrupted connection.");
    }

    this._connectionAttempts = 0;
    this._connectionDeferred = new Deferred<void>();
    this._connectionState = ConnectionState.CONNECTING;

    this._attemptConnection();

    return this._connectionDeferred.promise();
  }

  public disconnect(): void {
    if (this._connectionTimeoutTask !== null) {
      clearTimeout(this._connectionTimeoutTask);
      this._connectionTimeoutTask = null;
    }

    if (this._connectionAttemptTask !== null) {
      clearTimeout(this._connectionAttemptTask);
      this._connectionAttemptTask = null;
    }

    if (this._connectionDeferred !== null) {
      this._connectionDeferred.reject(new Error("Connection canceled by user"));
      this._connectionDeferred = null;
    }

    if (this._connectionState === ConnectionState.DISCONNECTED) {
      throw new Error("Connection is already disconnected.");
    } else {
      this._connectionState = ConnectionState.DISCONNECTING;

      this._authenticated = false;

      this._protocolConnection.close();
      this._handleDisconnected();

      if (typeof window !== "undefined") {
        window.removeEventListener("online", this._onWindowOnline);
      }
    }
  }

  public reconnect(): Promise<void> {
    if (this._connectionState !== ConnectionState.INTERRUPTED &&
      this._connectionState !== ConnectionState.DISCONNECTED) {
      throw new Error("Can only call reconnect on an disconnected connection.");
    }

    return this
      .connect()
      .then(() => this.authenticateWithReconnectToken(this._session.reconnectToken()))
      .then(() => {
        return;
      });
  }

  public isConnected(): boolean {
    return this._connectionState === ConnectionState.CONNECTED;
  }

  public isDisconnected(): boolean {
    return this._connectionState === ConnectionState.DISCONNECTED;
  }

  public isAuthenticated(): boolean {
    return this._authenticated;
  }

  public isOnline(): boolean {
    return this.isAuthenticated();
  }

  public send(message: IConvergenceMessage): void {
    this._protocolConnection.send(message);
  }

  public request(message: IConvergenceMessage, timeout?: number): Promise<IConvergenceMessage> {
    return this._protocolConnection.request(message, timeout);
  }

  public authenticateWithPassword(credentials: IUsernameAndPassword): Promise<void> {
    const message: IPasswordAuthRequestData = {
      username: credentials.username,
      password: credentials.password
    };
    return this._authenticate({password: message})
      .catch(e => {
        this.disconnect();
        return Promise.reject(e);
      });
  }

  public authenticateWithJwt(jwt: string): Promise<void> {
    const message: IJwtAuthRequestData = {jwt};
    return this._authenticate({jwt: message})
      .catch(e => {
        this.disconnect();
        return Promise.reject(e);
      });
  }

  public authenticateWithReconnectToken(token: string): Promise<void> {
    const message: IReconnectTokenAuthRequestData = {token};
    return this
      ._authenticate({reconnect: message})
      .catch((e) => {
        if (e instanceof ConvergenceError && e.code === ConvergenceErrorCodes.AUTHENTICATION_FAILED) {
          if (TypeChecker.isFunction(this._options.fallbackAuth)) {
            const authCoordinator = new FallbackAuthCoordinator();

            this._options.fallbackAuth(authCoordinator.challenge());
            if (!authCoordinator.isCompleted()) {
              return Promise.reject(new Error("You must call one of the auth challenge methods."));
            }

            authCoordinator.fulfilled().then(() => {
              if (authCoordinator.isPassword()) {
                const username = this.session().user().username;
                const password = authCoordinator.getPassword();
                return this.authenticateWithPassword({username, password});
              } else if (authCoordinator.isJwt()) {
                return this.authenticateWithJwt(authCoordinator.getJwt());
              } else if (authCoordinator.isAnonymous()) {
                return this.authenticateAnonymously(authCoordinator.getDisplayName());
              } else if (authCoordinator.isCanceled()) {
                return Promise.reject(e);
              } else {
                return Promise.reject(e);
              }
            });
          } else {
            return Promise.resolve(e);
          }
        } else {
          return Promise.resolve(e);
        }
      }).catch(e => {
        this.disconnect();
        return Promise.reject(e);
      });
  }

  public authenticateAnonymously(displayName?: string): Promise<void> {
    const message: IAnonymousAuthRequestData = {
      displayName: toOptional(displayName)
    };
    return this._authenticate({anonymous: message})
      .catch(e => {
        this.disconnect();
        return Promise.reject(e);
      });
  }

  public messages(): Observable<MessageEvent> {
    return this
      .events()
      .pipe(filter(e => e.name === "message")) as Observable<MessageEvent>;
  }

  private _authenticate(authRequest: IAuthenticationRequestMessage): Promise<void> {
    if (this._session.isAuthenticated()) {
      // The user is only allowed to authenticate once.
      return Promise.reject<void>(new ConvergenceError("User already authenticated."));
    } else if (this.isConnected()) {
      // We are connected already so we can just send the request.
      return this._sendAuthRequest(authRequest);
    } else if (this._connectionDeferred != null) {
      // We are connecting so defer this until after we connect.
      return this._connectionDeferred.promise().then(() => {
        return this._sendAuthRequest(authRequest);
      });
    } else {
      // We are not connecting and are not trying to connect.
      return Promise.reject<void>(
        new ConvergenceError("Must be connected or connecting to authenticate."));
    }
  }

  private _sendAuthRequest(authenticationRequest: IAuthenticationRequestMessage): Promise<void> {
    let method: AuthenticationMethod = null;
    if (authenticationRequest.anonymous) {
      method = AuthenticationMethods.ANONYMOUS;
    } else if (authenticationRequest.password) {
      method = AuthenticationMethods.PASSWORD;
    } else if (authenticationRequest.jwt) {
      method = AuthenticationMethods.JWT;
    } else if (authenticationRequest.reconnect) {
      method = AuthenticationMethods.RECONNECT;
    }

    const authenticatingEvent: IAuthenticatingEvent = {name: ConvergenceConnection.Events.AUTHENTICATING, method};
    this._emitEvent(authenticatingEvent);

    return this
      .request({authenticationRequest})
      .then((response: IConvergenceMessage) => {
        const authResponse: IAuthenticationResponseMessage = response.authenticationResponse;
        if (authResponse.success) {
          const success = authResponse.success;
          this._session._setUser(toDomainUser(success.user));
          this._session._setSessionId(success.sessionId);
          this._session._setReconnectToken(success.reconnectToken);
          this._authenticated = true;

          const authenticatedEvent: IAuthenticatedEvent = {
            name: ConvergenceConnection.Events.AUTHENTICATED,
            method,
            state: getOrDefaultObject(success.presenceState)
          };
          this._emitEvent(authenticatedEvent);
          return Promise.resolve();
        } else {
          const message = authResponse.failure.message;
          const authenticationFailedEvent: IAuthenticationFailedEvent = {
            name: ConvergenceConnection.Events.AUTHENTICATION_FAILED,
            method,
            message
          };
          this._emitEvent(authenticationFailedEvent);

          let errorMessage = `Authentication failed`;
          if (message) {
            errorMessage += ` (${message})`;
          }

          return Promise.reject(
              new ConvergenceError(errorMessage, ConvergenceErrorCodes.AUTHENTICATION_FAILED));
        }
      });
  }

  private _onWindowOnline = (_: Event) => {
    this._logger.debug(() => `Browser connectivity changed, restarting connection schedule.`);

    if (this._connectionState === ConnectionState.CONNECTING) {
      this._connectionAttempts = 0;
      this._attemptConnection();
    }
  };

  private _scheduleConnectionTimeout = () => {
    // Clear any previous timout
    this._clearConnectionTimeout();
    const timeout = this._options.connectionTimeout * 1000;
    this._connectionTimeoutTask = setTimeout(this._onConnectionTimeout, timeout);
  };

  private _clearConnectionTimeout = () => {
    if (this._connectionTimeoutTask !== null) {
      clearTimeout(this._connectionTimeoutTask);
      this._connectionTimeoutTask = null;
    }
  };

  private _onConnectionTimeout = () => {
    this._protocolConnection.abort("connection timeout exceeded");
  };

  private _attemptConnection(): void {
    if (this._connectionAttemptTask !== null) {
      clearTimeout(this._connectionAttemptTask);
      this._connectionAttemptTask = null;
    }

    this._connectionAttempts++;
    this._logger.debug(() => `Attempting to open web socket connection to: ${this._url}`);

    this._scheduleConnectionTimeout();

    this._emitEvent({name: ConvergenceConnection.Events.CONNECTING});

    const socket: ConvergenceSocket = new ConvergenceSocket(
      this._url,
      this._options.webSocketClass,
      this._options.webSocketFactory);
    this._protocolConnection = new ProtocolConnection(
      socket,
      {
        defaultRequestTimeout: this._options.defaultRequestTimeout,
        heartbeatConfig: {
          enabled: this._options.heartbeatEnabled,
          pingInterval: this._options.pingInterval,
          pongTimeout: this._options.pongTimeout
        }
      });

    this._protocolConnection
      .events()
      .subscribe(e => {
        switch (e.name) {
          case ProtocolConnection.Events.ERROR: {
            const errorEvent = e as IProtocolConnectionErrorEvent;
            const event: IConnectionErrorEvent = {name: ConvergenceConnection.Events.ERROR, error: errorEvent.error};
            this._emitEvent(event);
            break;
          }

          case ProtocolConnection.Events.DROPPED: {
            this._handleInterrupted();
            break;
          }

          case ProtocolConnection.Events.CLOSED: {
            this._handleDisconnected();
            break;
          }

          case ProtocolConnection.Events.MESSAGE: {
            const messageEvent = e as IProtocolConnectionMessageEvent;
            const event: MessageEvent = {
              name: ConvergenceConnection.Events.MESSAGE,
              request: messageEvent.request,
              callback: messageEvent.callback,
              message: messageEvent.message
            };
            this._emitEvent(event);
            break;
          }
        }
      });

    this._protocolConnection
      .connect()
      .then(() => {
        this._logger.debug("Connection succeeded, handshaking.");

        return this._protocolConnection
          .handshake()
          .then((handshakeResponse: IHandshakeResponseMessage) => {
            // We got a response so clear the timeout.
            clearTimeout(this._connectionTimeoutTask);

            // If the connection deferred is null, then it means the connection
            // was disconnected.
            if (this._connectionDeferred === null) {
              return;
            }

            if (handshakeResponse.success) {
              this._connectionState = ConnectionState.CONNECTED;
              this._emitEvent({name: ConvergenceConnection.Events.CONNECTED});

              this._connectionDeferred.resolve();
              this._connectionDeferred = null;

              // We reset the connection attempts to 0, so that when we get dropped
              // we will start with the first interval.
              this._connectionAttempts = 0;
            } else {
              this._emitEvent({name: ConvergenceConnection.Events.CONNECTION_FAILED});
              this._protocolConnection.close();

              if (handshakeResponse.retryOk) {
                this._scheduleConnection();
              } else {
                this._handleDisconnected();
                this._connectionDeferred.reject(
                  new ConvergenceError(handshakeResponse.error.details, handshakeResponse.error.code));
                this._connectionDeferred = null;
              }
            }
          })
          .catch((e: Error) => {
            this._logger.error("Handshake failed", e);
            this._protocolConnection.close();
            this._protocolConnection = null;
            // This will cause the code to fall into the next catch.
            return Promise.reject(e);
          });
      })
      .catch((_: Error) => {
        this._clearConnectionTimeout();
        this._emitEvent({name: ConvergenceConnection.Events.CONNECTION_FAILED});
        this._scheduleConnection();
      });
  }

  private _scheduleConnection(): void {
    if (this._connectionState === ConnectionState.CONNECTING) {
      const idx = Math.min(this._connectionAttempts, this._options.reconnectIntervals.length - 1);
      const delay = this._options.reconnectIntervals[idx];
      this._logger.debug(() => `Scheduling web socket connection in ${delay} seconds.`);
      const event: IConnectionScheduledEvent = {name: ConvergenceConnection.Events.CONNECTION_SCHEDULED, delay};
      this._emitEvent(event);

      this._connectionAttemptTask = setTimeout(() => this._attemptConnection(), delay * 1000);
    }
  }

  private _handleDisconnected(): void {
    if (this._connectionState !== ConnectionState.DISCONNECTED) {
      this._connectionState = ConnectionState.DISCONNECTED;
      this._emitEvent({name: ConvergenceConnection.Events.DISCONNECTED});
    }
  }

  private _handleInterrupted(): void {
    this._authenticated = false;
    this._connectionState = ConnectionState.INTERRUPTED;
    this._emitEvent({name: ConvergenceConnection.Events.INTERRUPTED});
    if (this._options.autoReconnect && this._session.reconnectToken()) {
      this
        .reconnect()
        .catch(e => this._logger.error("Unexpected error reconnecting", e));
    }
  }
}

/**
 * @hidden
 * @internal
 */
export interface IConnectionEvent extends IConvergenceEvent {

}

/**
 * @hidden
 * @internal
 */
export interface IConnectionErrorEvent extends IConnectionEvent {
  name: "error";
  error: Error;
}

/**
 * @hidden
 * @internal
 */
export interface IAuthenticatingEvent extends IConnectionEvent {
  name: "authenticating";
  method: AuthenticationMethod;
}

/**
 * @hidden
 * @internal
 */
export interface IAuthenticatedEvent extends IConnectionEvent {
  name: "authenticated";
  method: AuthenticationMethod;
  state: { [key: string]: any };
}

/**
 * @hidden
 * @internal
 */
export interface IAuthenticationFailedEvent extends IConnectionEvent {
  name: "authenticationFailed";
  method: AuthenticationMethod;
  message?: string;
}

/**
 * @hidden
 * @internal
 */
export interface IConnectionScheduledEvent extends IConnectionEvent {
  name: "connection_scheduled";
  delay: number;
}

/**
 * @hidden
 * @internal
 */
export interface MessageEvent extends IConnectionEvent {
  name: "message";
  message: IConvergenceMessage; // Model Message??
  request: boolean;
  callback?: ReplyCallback;
}

/**
 * @hidden
 * @internal
 */
enum ConnectionState {
  DISCONNECTED, CONNECTING, CONNECTED, INTERRUPTED, DISCONNECTING
}
