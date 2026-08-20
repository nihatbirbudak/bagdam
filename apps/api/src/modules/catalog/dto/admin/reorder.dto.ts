import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, Matches } from 'class-validator';
import { ID_RE } from './transforms';

/** `POST …/reorder {ids:[…]}` — dizideki sıra sortOrder 0..n-1 olur (listede olmayanlar dokunulmaz). */
export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(ID_RE, { each: true, message: 'ids geçersiz kimlik içeriyor' })
  ids!: string[];
}
