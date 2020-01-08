import { Config } from './config';
import { TabRotationConfig } from "./tab-rotation-config";
import { CONFIG_UPDATED_MESSAGE } from './messages';
import { tap, switchMap, catchError, filter, map } from 'rxjs/operators';
import { timer, of, Subject, Observable } from 'rxjs';
import { TabRotateSession } from './tab-rotate-session';
import deepEqual from 'deep-equal';
import { Tab } from './tab';

export interface TabRotationStatus {
  status: 'running' | 'stopped' | 'error' | 'paused' | 'waiting';
  message?: string;
}

export class TabRotator {

  private readonly _options = new Config();
  private _config: TabRotationConfig;
  private _session: TabRotateSession;
  private _initialized = false;
  private _statusChanged = new Subject<TabRotationStatus>();

  public get StatusChanged(): Observable<TabRotationStatus> {
    return this._statusChanged.asObservable();
  }

  public get isStarted(): boolean {
    return this._session !== undefined;
  }

  public get isActive(): boolean {
    return this._session !== undefined && this._session.isActive;
  }

  public get isPaused(): boolean {
    return this._session !== undefined && this._session.paused;
  }

  constructor() {

    chrome.runtime.onMessage.addListener((message) => {
    if (message === CONFIG_UPDATED_MESSAGE) {
        this._options.load();
    }
    });

    this._options.ConfigLoaded.pipe(
      tap(config => {
        console.log("loaded tab rotate config... - reload interval: " + +config.reload_interval * 1000 + "ms")
        console.log(config);
      }),
      switchMap(config =>
        timer(0, +config.reload_interval * 1000).pipe(
          switchMap(() => config.getTabRotationConfig()),
          catchError(error => {
            console.error(error);
            return of(undefined);
          })
        )
      ),
      map(config => config as TabRotationConfig),
      filter(config => !deepEqual(this._config, config))
    ).subscribe(config => {
      console.log("Loaded remote config:");
      console.log(config);
      this._config = config;
      
      if (this._config.autoStart) {
        if (this._initialized) {
          this.reload();
        } else {
          this.start();
        }
      } else {
        this.stop();
      }
      
      this._initialized = true;
    });

    this._options.load();
  }

  public start(): TabRotationStatus {
    let status: TabRotationStatus;
    if (!this._initialized) {
      status = {status: 'waiting', message: 'wating for initialization (config loading)'};
      this._statusChanged.next(status);
      return status;
    }

    if (this._config === undefined) {
      status = {status: 'error', message: 'cannot start tab rotation: config is undefined.'};
      this._statusChanged.next(status);
      return status;
    };
    if (this._session && this._session.isActive) return this.reload();

    this._session = new TabRotateSession(this._config);
    this._session.load().then(() => {
      this._session.start();
      status = {status: 'running'};
      this._statusChanged.next(status);
    });
  }

  public reload(): TabRotationStatus {
    if (this._config === undefined) {
        return this.stop();
    } else if (!this._session) {
      return { status: 'error', message: 'tab rotation not running - cannot reload'}
    }

    this.stop();
    this.start();
  }

  public stop(): TabRotationStatus {
    if (this._session) this._session.stop();
    this._session = undefined;

    return {status: 'stopped'};
  }

  public pause(): TabRotationStatus {
    if (this._session) {
      this._session.pause();
      return {status: 'paused'}
    }
    return { status: 'error', message: 'Tab rotation not running - cannot pause'};
  }

  public resume(): TabRotationStatus {
    if (!this._session) {
      return {status: 'error', message: 'Tab rotation not running - cannot resume'};
    } else if (!this._session.paused) {
      return {status: 'running'}
    }
    this._session.start();
  }
}