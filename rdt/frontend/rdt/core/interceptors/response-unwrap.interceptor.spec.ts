import { HttpHandler, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { ResponseUnwrapInterceptor } from './response-unwrap.interceptor';

describe('ResponseUnwrapInterceptor', () => {
  function run(body: unknown) {
    const interceptor = new ResponseUnwrapInterceptor();
    const handler: HttpHandler = { handle: () => of(new HttpResponse({ body })) };
    let result: unknown;
    interceptor.intercept(new HttpRequest('GET', '/api/x'), handler).subscribe((e) => {
      result = (e as HttpResponse<unknown>).body;
    });
    return result;
  }

  it('unwraps {data, message} envelope to just data', () => {
    expect(run({ data: { foo: 1 }, message: 'OK' })).toEqual({ foo: 1 });
  });

  it('leaves a body that is not the envelope shape untouched', () => {
    expect(run({ foo: 1 })).toEqual({ foo: 1 });
  });

  it('leaves a null body untouched', () => {
    expect(run(null)).toBeNull();
  });
});
