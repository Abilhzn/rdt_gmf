import { ApiResponse as ApiResponseDto } from './dtos/api-response.dto';

/**
 * Dibuat untuk di-extend, bukan hiasan: sediakan `ok()` supaya controller turunan tidak
 * `new ApiResponse(...)` berulang-ulang. Contoh pemakaian: `HealthController` di `src/health/`.
 */
export abstract class BaseController {
  protected ok<T>(data: T, message?: string): ApiResponseDto<T> {
    return ApiResponseDto.of(data, message);
  }
}
