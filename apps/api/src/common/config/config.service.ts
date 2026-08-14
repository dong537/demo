import { Injectable } from '@nestjs/common';
import { env, EnvConfig } from './env.schema';

@Injectable()
export class ConfigService {
  get<T extends keyof EnvConfig>(key: T): EnvConfig[T] {
    return env[key];
  }
}
