import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post as HttpPost,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { PostsService } from './posts.service';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @HttpPost()
  async create(@Req() request: any, @Body() dto: CreatePostDto) {
    return this.postsService.create(request.user.userId, dto);
  }

  @Get()
  async findAll(
    @Req() request: any,
  ) {
    const page = Number(request.query.page) || 1;
    const limit = Number(request.query.limit) || 10;

    return this.postsService.findAll(page, limit);
  }

  @Get(':id/detail')
  async findOneDetailed(
    @Req() request: any,
    @Param('id') id: string,
  ) {
    return this.postsService.findOneDetailed(
      id,
      request.user.userId,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.postsService.findOne(id);
  }

  @Delete('comments/:commentId')
  async deleteComment(
    @Req() request: any,
    @Param('commentId') commentId: string,
  ) {
    return this.postsService.deleteComment(
      commentId,
      request.user.userId,
    );
  }

  @Delete(':id')
  async remove(@Req() request: any, @Param('id') id: string) {
    await this.postsService.remove(id, request.user.userId);

    return {
      message: 'Post deleted successfully',
    };
  }

  @HttpPost(':id/like')
  async toggleLike(
    @Req() request: any,
    @Param('id') id: string,
  ) {
    return this.postsService.toggleLike(id, request.user.userId);
  }

  @Get(':id/comments')
  async getComments(@Param('id') id: string) {
    return this.postsService.getComments(id);
  }

  @HttpPost(':id/comments')
  async addComment(
    @Req() request: any,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.postsService.addComment(
      id,
      request.user.userId,
      dto,
    );
  }

}
