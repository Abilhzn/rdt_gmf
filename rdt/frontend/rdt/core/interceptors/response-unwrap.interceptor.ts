import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

// backend wraps every successful response as `{ data, message }` (`ApiResponse`,
// `core/dtos/api-response.dto.ts`). Unwrapping it here once means the 16-odd RDT services can
// just declare `http.get<Foo>(...)` and get `Foo` back, instead of every call site repeating
// `.pipe(map(res => res.data))`.
//
// Only unwraps a response that actually looks like the envelope (object body with both `data` and
// `message` keys) — a blob/text download, or any response that doesn't match, passes through
// untouched rather than being guessed at.
@Injectable()
export class ResponseUnwrapInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      map((event) => {
        if (!(event instanceof HttpResponse)) return event;
        const body = event.body as unknown;
        if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body && 'message' in body) {
          return event.clone({ body: (body as { data: unknown }).data });
        }
        return event;
      }),
    );
  }
}
