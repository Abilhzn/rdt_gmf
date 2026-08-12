import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpErrorResponse } from '@angular/common/http';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

// Checklist 2.2 (12 Agu): every HTTP call this app makes used to have NO client-side timeout at
// all — a hung request (backend stuck, network dropped mid-flight, dst) left whatever spinner
// was showing running forever, no way for the user to tell "still working" from "never coming
// back". 30s matches the backend's own server-side timeout (see rdt/backend/src/index.js's
// request-timeout middleware) so client and server agree on how long "too long" is.
const REQUEST_TIMEOUT_MS = 30000;

@Injectable()
export class TimeoutInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      timeout(REQUEST_TIMEOUT_MS),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          // Same { ok:false, error } shape every backend response already uses, so existing
          // `err?.error?.error` / `err?.message` display code picks this up without needing a
          // special case for "this specific error came from the client, not the server".
          return throwError(() => new HttpErrorResponse({
            error: { ok: false, error: 'Request tidak dapat respons dalam 30 detik — coba lagi atau cek koneksi.', code: 'CLIENT_TIMEOUT' },
            status: 0,
            statusText: 'Request Timeout (client-side)',
            url: req.url,
          }));
        }
        return throwError(() => err);
      }),
    );
  }
}
