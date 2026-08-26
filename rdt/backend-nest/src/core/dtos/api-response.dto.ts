/**
 * Bentuk response sukses yang konsisten di seluruh API. Error tetap lewat
 * GlobalExceptionFilter (throw, bukan return).
 */
export class ApiResponse<T> {
  constructor(
    public readonly data: T,
    public readonly message: string = 'OK',
  ) {}

  static of<T>(data: T, message = 'OK'): ApiResponse<T> {
    return new ApiResponse(data, message);
  }
}
