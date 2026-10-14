import { Injectable, type PipeTransform } from '@nestjs/common';
import { ApiError } from './exception.filter';

/** Malformed ids are reported as 404, the same as unknown ones. */
@Injectable()
export class ObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[a-f\d]{24}$/i.test(value)) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    return value;
  }
}
